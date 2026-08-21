import { createRequire } from 'node:module'
import { loadConfig, validateConfig } from './config.js'
import { prepareImage } from './images.js'
import { resolveImageInput } from './resolve-source.js'
import { describeImage } from './vision.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const TOOL = {
  name: 'vision_describe',
  description:
    '【必须先调用再回答】用视觉模型识别图片并返回文字描述。编码模型无法看图：涉及图片内容时必须先调本工具，严禁猜图。' +
    '传图（任选其一）：path=本地路径 | url=图片URL | path/source=clipboard（读系统剪贴板，推荐截图后用）| ' +
    'path=recent（最近落盘附件）| path=#N（Claude image-cache）| image_data=base64。' +
    '禁止让用户把图粘贴进对话。question=针对图片的问题（强烈建议）。拿到 tool result 后再回答。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description:
          '本地路径，或别名：clipboard / recent / #1 / [Image #1]',
      },
      url: { type: 'string', description: '图片 URL' },
      source: {
        type: 'string',
        description: '可选别名，同 path：clipboard | recent | #N',
      },
      image_data: { type: 'string', description: '图片 base64（一般不推荐；优先 path/clipboard）' },
      media_type: {
        type: 'string',
        description: '配合 image_data 的 MIME，如 image/png',
      },
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
  const source = typeof args.source === 'string' ? args.source : undefined
  const imageData = typeof args.image_data === 'string' ? args.image_data : undefined
  const mediaType = typeof args.media_type === 'string' ? args.media_type : undefined
  const question = typeof args.question === 'string' ? args.question : undefined
  if (!path && !url && !imageData && !source) {
    return {
      content: [
        {
          type: 'text',
          text:
            '[vision-relay] 错误: 必须提供 path、url、image_data 或 source=clipboard|recent|#N。' +
            '不要把图粘贴进对话；可截图后 path=clipboard。',
        },
      ],
      isError: true,
    }
  }
  try {
    const { config } = loadConfig()
    const errs = validateConfig(config)
    if (errs.length) {
      return { content: [{ type: 'text', text: `[vision-relay] 配置不完整: ${errs.join('; ')}` }], isError: true }
    }
    const resolved = await resolveImageInput({
      path,
      url,
      source,
      image_data: imageData,
      media_type: mediaType,
      maxBytes: config.vision.maxImageBytes,
    })
    const prepared = await prepareImage(resolved.image, {
      targetBytes: config.vision.targetImageBytes,
      maxEdge: config.vision.maxImageEdge,
    })
    const text = await describeImage(config.vision, prepared, question)
    const header = `[vision-relay] source=${resolved.label}\n`
    return { content: [{ type: 'text', text: header + text }] }
  } catch (e) {
    return { content: [{ type: 'text', text: `[vision-relay] 错误: ${(e as Error).message}` }], isError: true }
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
        serverInfo: { name: 'vision-relay', version },
      }
    } else if (method === 'tools/list') {
      result = { tools: [TOOL] }
    } else if (method === 'tools/call') {
      if (params?.name !== TOOL.name) {
        throw new Error(`unknown tool: ${String(params?.name)}（可用工具: ${TOOL.name}）`)
      }
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
  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve)
    process.stdin.on('error', resolve)
  })
}

/** 导出供测试：处理单条 JSON-RPC 消息 */
export async function handleMessageForTest(msg: unknown): Promise<void> {
  await handleMessage(msg as JsonRpcRequest)
}
