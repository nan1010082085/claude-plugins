import { createRequire } from 'node:module'
import { loadConfig, validateConfig } from './config.js'
import { prepareImage, readImageRef } from './images.js'
import { describeImage } from './vision.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const TOOL = {
  name: 'vision_describe',
  description:
    '【必须先调用再回答】用视觉模型识别图片并返回详细文字描述。' +
    '编码模型无法看图时：凡涉及图片内容，必须先调用本工具拿到描述，严禁凭文件名或上下文猜测。' +
    '传图（任选其一）：path=本地路径；url=图片URL；image_data=base64。' +
    'question=针对图片的具体问题（强烈建议传入，让描述围绕问题）。' +
    '拿到 tool result 后再回答用户；描述不足则换更具体的 question 重试。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: '本地图片路径（png/jpg/gif/webp/bmp/svg）' },
      url: { type: 'string', description: '图片 URL' },
      image_data: { type: 'string', description: '图片的 base64 编码数据（从对话上下文中的 Image content block 获取）' },
      media_type: { type: 'string', description: '图片 MIME 类型（配合 image_data 使用，如 image/png、image/jpeg）。不传则自动推断为 image/png' },
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
  const imageData = typeof args.image_data === 'string' ? args.image_data : undefined
  const mediaType = typeof args.media_type === 'string' ? args.media_type : undefined
  const question = typeof args.question === 'string' ? args.question : undefined
  if (!path && !url && !imageData) {
    return {
      content: [{ type: 'text', text: '[vision-relay] 错误: 必须提供 path、url 或 image_data 参数' }],
      isError: true,
    }
  }
  try {
    const { config } = loadConfig()
    const errs = validateConfig(config)
    if (errs.length) {
      return { content: [{ type: 'text', text: `[vision-relay] 配置不完整: ${errs.join('; ')}` }], isError: true }
    }
    let image: import('./images.js').ImageInput
    if (imageData) {
      // base64 直传模式：从对话上下文的 Image content block 获取
      const buf = Buffer.from(imageData, 'base64')
      // 简单推断 MIME 类型
      const inferredType = mediaType
        || (buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png'
          : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
            : buf[0] === 0x47 && buf[1] === 0x49 ? 'image/gif'
              : buf[0] === 0x52 && buf[1] === 0x49 ? 'image/webp'
                : 'image/png')
      image = { data: buf, mediaType: inferredType, source: 'base64' }
    } else {
      image = await readImageRef(
        { kind: url ? 'url' : 'path', value: url || path! },
        process.cwd(),
        config.vision.maxImageBytes,
      )
    }
    const prepared = await prepareImage(image, {
      targetBytes: config.vision.targetImageBytes,
      maxEdge: config.vision.maxImageEdge,
    })
    const text = await describeImage(config.vision, prepared, question)
    return { content: [{ type: 'text', text }] }
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
