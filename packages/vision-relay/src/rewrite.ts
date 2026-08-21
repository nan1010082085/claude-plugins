import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { Config } from './config.js'
import { prepareImage, type ImageInput } from './images.js'
import { describeImage } from './vision.js'

/** 图片描述内存缓存（单会话进程内，有上限） */
export type DescCache = Map<string, string>

const DEFAULT_CACHE_MAX = 64

function hashBytes(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function cacheSet(cache: DescCache, key: string, value: string, max = DEFAULT_CACHE_MAX): void {
  if (cache.size >= max && !cache.has(key)) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, value)
}

/** 粗估 base64 解码后字节数 */
export function estimateBase64Bytes(b64: string): number {
  const len = b64.replace(/\s/g, '').length
  return Math.floor((len * 3) / 4)
}

/** 去掉 IPv6 方括号 */
export function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase()
}

/** 将 IPv4-mapped IPv6（点分或十六进制）还原为 IPv4 点分 */
export function ipv4MappedToDotted(host: string): string | null {
  const h = normalizeHost(host)
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (dotted) return dotted[1]!
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!hex) return null
  const hi = parseInt(hex[1]!, 16)
  const lo = parseInt(hex[2]!, 16)
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

function isPrivateOrLoopbackIpv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b! >= 16 && b! <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** 是否为本机 / 回环（含 IPv4-mapped、方括号 IPv6）。不含一般私网（LAN 上游合法）。 */
export function isLoopbackHost(host: string): boolean {
  const h = normalizeHost(host)
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  const mapped = ipv4MappedToDotted(h)
  if (mapped) return mapped.startsWith('127.')
  if (isIP(h) === 4) return h.startsWith('127.')
  if (isIP(h) === 6) return h === '::1'
  return false
}

/** 是否为私网 / 本机 / 链路本地（SSRF 拒绝） */
export function isPrivateOrLocalHost(host: string): boolean {
  const h = normalizeHost(host)
  if (isLoopbackHost(h)) return true
  if (h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local')) return true
  const mapped = ipv4MappedToDotted(h)
  if (mapped) return isPrivateOrLoopbackIpv4(mapped)
  if (isIP(h) === 4) return isPrivateOrLoopbackIpv4(h)
  if (isIP(h) === 6) {
    return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')
  }
  return false
}

function parseDataUri(url: string, maxBytes: number): ImageInput | null {
  const m = url.match(/^data:([^;]+);base64,(.+)$/i)
  if (!m) return null
  if (estimateBase64Bytes(m[2]!) > maxBytes) return null
  const data = Buffer.from(m[2]!, 'base64')
  if (data.length > maxBytes) return null
  return { data, mediaType: m[1]!, source: 'data-uri' }
}

/** 是否为应强制替换的图片类 content block（即使解析失败也不得放行） */
export function isImageLikeBlock(block: Record<string, unknown>): boolean {
  const t = block.type
  return t === 'image' || t === 'image_url'
}

/**
 * 从 Anthropic / OpenAI 风格 content block 抽出图片。
 * 解析失败返回 null（调用方仍须替换为占位文本）。
 */
export function imageFromBlock(block: Record<string, unknown>, maxBytes: number): ImageInput | null {
  const type = block.type
  if (type === 'image') {
    const source = block.source
    if (source && typeof source === 'object') {
      const s = source as Record<string, unknown>
      if (s.type === 'base64' && typeof s.data === 'string') {
        if (estimateBase64Bytes(s.data) > maxBytes) return null
        const data = Buffer.from(s.data, 'base64')
        if (data.length > maxBytes) return null
        const mt = typeof s.media_type === 'string' ? s.media_type : 'image/png'
        return { data, mediaType: mt, source: 'anthropic:base64' }
      }
      if (s.type === 'url' && typeof s.url === 'string') {
        if (s.url.startsWith('data:')) return parseDataUri(s.url, maxBytes)
        return { data: Buffer.alloc(0), mediaType: 'image/png', source: `url:${s.url}` }
      }
    }
    if (block.file && typeof block.file === 'object') {
      const file = block.file as Record<string, unknown>
      if (typeof file.base64 === 'string') {
        if (estimateBase64Bytes(file.base64) > maxBytes) return null
        const data = Buffer.from(file.base64, 'base64')
        if (data.length > maxBytes) return null
        const mt = typeof file.type === 'string' ? file.type : 'image/png'
        return { data, mediaType: mt, source: 'file:base64' }
      }
    }
  }
  if (type === 'image_url' && block.image_url && typeof block.image_url === 'object') {
    const url = (block.image_url as Record<string, unknown>).url
    if (typeof url === 'string') {
      if (url.startsWith('data:')) return parseDataUri(url, maxBytes)
      return { data: Buffer.alloc(0), mediaType: 'image/png', source: `url:${url}` }
    }
  }
  return null
}

/** 拒绝非 http(s)、私网/回环/链路本地，降低 SSRF 面 */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('非法图片 URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`不允许的 URL 协议: ${u.protocol}`)
  }
  if (isPrivateOrLocalHost(u.hostname)) {
    throw new Error('禁止访问本机/私网图片 URL')
  }
  return u
}

async function loadUrlImage(url: string, maxBytes: number, timeoutMs: number): Promise<ImageInput> {
  assertPublicHttpUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' })
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`)
    const cl = res.headers.get('content-length')
    if (cl && Number(cl) > maxBytes) throw new Error('图片超过硬上限')
    const reader = res.body?.getReader()
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > maxBytes) throw new Error('图片超过硬上限')
      return {
        data: buf,
        mediaType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
        source: url,
      }
    }
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        reader.cancel().catch(() => {})
        throw new Error('图片超过硬上限')
      }
      chunks.push(Buffer.from(value))
    }
    return {
      data: Buffer.concat(chunks),
      mediaType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
      source: url,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function describeBlock(
  cfg: Config,
  block: Record<string, unknown>,
  cache: DescCache,
): Promise<string> {
  const maxBytes = cfg.vision.maxImageBytes
  const extracted = imageFromBlock(block, maxBytes)
  if (!extracted) return '（无法解析或超限的图片块，已剥离）'

  try {
    let image = extracted
    if (extracted.source.startsWith('url:') && extracted.data.length === 0) {
      const url = extracted.source.slice(4)
      image = await loadUrlImage(url, maxBytes, cfg.vision.timeoutMs)
    }

    const key = hashBytes(image.data)
    const hit = cache.get(key)
    if (hit) return hit

    const prepared = await prepareImage(image, {
      targetBytes: cfg.vision.targetImageBytes,
      maxEdge: cfg.vision.maxImageEdge,
    })
    const text = await describeImage(cfg.vision, prepared)
    cacheSet(cache, key, text)
    return text
  } catch (e) {
    return `（视觉识别失败: ${(e as Error).message}）`
  }
}

function textBlock(text: string): Record<string, unknown> {
  return {
    type: 'text',
    text: `[vision-relay] ✓ 已将粘贴图转为文字描述（用户侧可见终端日志）\n${text}`,
  }
}

/** 递归改写 content（string | block[]），图片块一律 → 文字块 */
export async function rewriteContent(
  cfg: Config,
  content: unknown,
  cache: DescCache,
): Promise<unknown> {
  if (typeof content === 'string' || content == null) return content
  if (!Array.isArray(content)) return content

  const out: unknown[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    const block = raw as Record<string, unknown>
    if (isImageLikeBlock(block)) {
      const desc = await describeBlock(cfg, block, cache)
      out.push(textBlock(desc))
      continue
    }
    if (block.type === 'tool_result') {
      out.push({
        ...block,
        content: await rewriteContent(cfg, block.content, cache),
      })
      continue
    }
    out.push(block)
  }
  return out
}

/**
 * 改写 Anthropic /messages 或 OpenAI /chat/completions 请求体中的图片。
 * 无图时原样返回；有图时替换为文字（失败也替换占位，绝不放行原图）。
 */
export async function rewriteRequestBody(
  cfg: Config,
  body: unknown,
  cache: DescCache,
): Promise<{ body: unknown; rewritten: number }> {
  if (!body || typeof body !== 'object') return { body, rewritten: 0 }
  const obj = body as Record<string, unknown>
  const messages = obj.messages
  if (!Array.isArray(messages)) return { body, rewritten: 0 }

  let rewritten = 0
  const nextMessages = []
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      nextMessages.push(msg)
      continue
    }
    const m = msg as Record<string, unknown>
    const before = JSON.stringify(m.content)
    const content = await rewriteContent(cfg, m.content, cache)
    if (JSON.stringify(content) !== before && Array.isArray(content)) {
      rewritten += content.filter(
        (b) =>
          b &&
          typeof b === 'object' &&
          (b as { type?: string; text?: string }).type === 'text' &&
          String((b as { text?: string }).text ?? '').startsWith('[vision-relay]'),
      ).length
    }
    nextMessages.push({ ...m, content })
  }
  return { body: { ...obj, messages: nextMessages }, rewritten }
}

/** 请求路径是否为需要改写的对话接口 */
export function isChatPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  return (
    p.endsWith('/messages') ||
    p.endsWith('/chat/completions') ||
    p === '/messages' ||
    p === '/chat/completions'
  )
}
