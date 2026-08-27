import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from './config.js'
import { isChatPath, isLoopbackHost, rewriteRequestBody, type DescCache } from './rewrite.js'

export interface SessionProxyOptions {
  config: Config
  /** 真实编码上游（cc-switch / settings 中的 ANTHROPIC_BASE_URL），不得为本机改写地址 */
  upstreamBaseUrl: string
  /** 固定端口；0 = 系统分配 */
  port?: number
  /** 仅测试：允许上游为本机（生产包装启动不得开启） */
  allowLoopbackUpstream?: boolean
}

export interface SessionProxy {
  port: number
  baseUrl: string
  close: () => Promise<void>
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error(`请求体超过 ${maxBytes} 字节`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function joinUpstream(upstreamBaseUrl: string, reqUrl: string | undefined): string {
  const base = upstreamBaseUrl.replace(/\/+$/, '')
  const path = reqUrl && reqUrl.startsWith('/') ? reqUrl : `/${reqUrl ?? ''}`
  return `${base}${path}`
}

function hopByHopHeaders(): Set<string> {
  return new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
  ])
}

/**
 * 启动仅绑定 127.0.0.1 的会话改写服务。
 * 对话接口：剥离 Image block → 转文字 → 转发上游；其它路径原样透传。
 */
export async function startSessionProxy(opts: SessionProxyOptions): Promise<SessionProxy> {
  const upstream = opts.upstreamBaseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(upstream)) {
    throw new Error(`无效上游: ${opts.upstreamBaseUrl}`)
  }
  if (!opts.allowLoopbackUpstream) {
    try {
      if (isLoopbackHost(new URL(upstream).hostname)) {
        throw new Error('上游不能是本机地址（避免改写环路）；请用 cc-switch / settings 中的真实编码上游')
      }
    } catch (e) {
      if ((e as Error).message.includes('环路') || (e as Error).message.includes('本机')) throw e
      throw new Error(`无效上游: ${opts.upstreamBaseUrl}`)
    }
  }

  const cache: DescCache = new Map()
  const maxBody = Math.max(opts.config.vision.maxImageBytes * 4, 32 * 1024 * 1024)

  const server: Server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        config: opts.config,
        upstream,
        cache,
        maxBody,
      })
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: (e as Error).message } }))
      } else {
        res.destroy()
      }
    }
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('无法绑定本地端口'))
        return
      }
      resolve(addr.port)
    })
  })

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    config: Config
    upstream: string
    cache: DescCache
    maxBody: number
  },
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = req.url ?? '/'
  const pathname = url.split('?')[0] ?? '/'

  if (method === 'GET' && (pathname === '/healthz' || pathname === '/')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'vision-relay-session' }))
    return
  }

  let bodyBuf = Buffer.alloc(0)
  if (method !== 'GET' && method !== 'HEAD') {
    bodyBuf = await readBody(req, ctx.maxBody)
  }

  let forwardBody: Buffer | undefined = bodyBuf.length ? bodyBuf : undefined
  if (method === 'POST' && isChatPath(pathname) && bodyBuf.length) {
    let parsed: unknown
    try {
      parsed = JSON.parse(bodyBuf.toString('utf8')) as unknown
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: '对话接口请求体必须是合法 JSON' } }))
      return
    }

    // 诊断：记录请求中的 content block 类型
    if (process.env.VISION_RELAY_DEBUG) {
      try {
        const obj = parsed as Record<string, unknown>
        const msgs = Array.isArray(obj.messages) ? obj.messages : []
        const blockTypes: string[] = []
        for (const msg of msgs) {
          if (msg && typeof msg === 'object') {
            const content = (msg as Record<string, unknown>).content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === 'object') {
                  const b = block as Record<string, unknown>
                  blockTypes.push(b.type as string || 'unknown')
                  if (b.type === 'image' || b.type === 'image_url') {
                    process.stderr.write(`[vision-relay DEBUG] 发现图片 block: type=${b.type}, keys=${JSON.stringify(Object.keys(b))}\n`)
                  }
                }
              }
            }
          }
        }
        process.stderr.write(`[vision-relay DEBUG] ${pathname} content block types: ${JSON.stringify(blockTypes)}\n`)
      } catch {}
    }

    const { body, rewritten } = await rewriteRequestBody(ctx.config, parsed, ctx.cache)
    if (rewritten > 0 && process.env.VISION_RELAY_DEBUG) {
      process.stderr.write(
        `[vision-relay DEBUG] 会话改写: 已将 ${rewritten} 张图转为文字并转发上游\n`,
      )
    } else if (process.env.VISION_RELAY_DEBUG) {
      process.stderr.write(`[vision-relay DEBUG] 未发现需要改写的图片块\n`)
    }
    forwardBody = Buffer.from(JSON.stringify(body), 'utf8')
  }

  const target = joinUpstream(ctx.upstream, url)
  const headers: Record<string, string> = {}
  const skip = hopByHopHeaders()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null || skip.has(k.toLowerCase())) continue
    headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  if (forwardBody) headers['content-length'] = String(forwardBody.length)

  const upstreamRes = await fetch(target, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : forwardBody,
    redirect: 'manual',
  })

  const outHeaders: Record<string, string | string[]> = {}
  upstreamRes.headers.forEach((value, key) => {
    if (skip.has(key.toLowerCase())) return
    outHeaders[key] = value
  })
  res.writeHead(upstreamRes.status, outHeaders)

  if (!upstreamRes.body) {
    res.end()
    return
  }
  const reader = upstreamRes.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((r) => res.once('drain', r))
      }
    }
    res.end()
  } catch {
    res.destroy()
  }
}
