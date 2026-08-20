import { createRequire } from 'node:module'
import { loadConfig, validateConfig } from './config.js'
import { readImageRef } from './images.js'
import { describeImage } from './vision.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const TOOL = {
  name: 'vision_describe',
  description:
    '用视觉模型识别图片并返回详细描述。path 为本地图片路径，url 为图片地址，二者提供其一；question 为可选的针对图片的问题（如"这个报错是什么原因"）。适用于无视觉能力的模型需要理解图片的场景。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '本地图片路径（png/jpg/gif/webp/bmp/svg）' },
      url: { type: 'string', description: '图片 URL' },
      question: { type: 'string', description: '针对图片的问题，作为识别提示词' },
    },
  },
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

async function callTool(params: Record<string, unknown> | undefined): Promise<unknown> {
  const args = (params?.arguments ?? {}) as Record<string, unknown>
  const path = typeof args.path === 'string' ? args.path : undefined
  const url = typeof args.url === 'string' ? args.url : undefined
  const question = typeof args.question === 'string' ? args.question : undefined
  if (!path && !url) {
    return {
      content: [{ type: 'text', text: '[vision-bridge] 错误: 必须提供 path 或 url 参数' }],
      isError: true,
    }
  }
  try {
    const { config } = loadConfig()
    const errs = validateConfig(config)
    if (errs.length) {
      return { content: [{ type: 'text', text: `[vision-bridge] 配置不完整: ${errs.join('; ')}` }], isError: true }
    }
    const image = await readImageRef({ kind: url ? 'url' : 'path', value: url || path! }, process.cwd())
    const text = await describeImage(config.vision, image, question)
    return { content: [{ type: 'text', text: `[vision-bridge 对 ${image.source} 的识别结果]\n${text}` }] }
  } catch (e) {
    return { content: [{ type: 'text', text: `[vision-bridge] 错误: ${(e as Error).message}` }], isError: true }
  }
}

async function handleMessage(msg: JsonRpcRequest): Promise<void> {
  if (!msg.method || msg.method.startsWith('notifications/')) return
  const { id, method, params } = msg
  try {
    let result: unknown
    if (method === 'initialize') {
      result = {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'vision-bridge', version },
      }
    } else if (method === 'tools/list') {
      result = { tools: [TOOL] }
    } else if (method === 'tools/call') {
      result = await callTool(params)
    } else if (method === 'ping') {
      result = {}
    } else {
      throw new Error(`unknown method: ${method}`)
    }
    send({ jsonrpc: '2.0', id, result })
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: (e as Error).message } })
  }
}

/** stdio MCP server：逐行 JSON-RPC，由终端按需拉起，无常驻进程 */
export async function runMcpServer(): Promise<void> {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buf += chunk
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      try {
        void handleMessage(JSON.parse(line))
      } catch {
        // 非 JSON 行忽略
      }
    }
  })
  await new Promise<void>((resolve) => process.stdin.on('end', resolve))
}
