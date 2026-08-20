import type { VisionConfig } from './config.js'
import type { ImageInput } from './images.js'

export function openaiUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  return `${b}/chat/completions`
}

export function anthropicUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (b.endsWith('/messages')) return b
  if (b.endsWith('/v1')) return `${b}/messages`
  return `${b}/v1/messages`
}

export function buildOpenAIBody(cfg: VisionConfig, image: ImageInput, question?: string): unknown {
  const dataUri = `data:${image.mediaType};base64,${image.data.toString('base64')}`
  return {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: question || cfg.prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
  }
}

export function buildAnthropicBody(cfg: VisionConfig, image: ImageInput, question?: string): unknown {
  return {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') },
          },
          { type: 'text', text: question || cfg.prompt },
        ],
      },
    ],
  }
}

export function extractText(json: unknown, type: 'openai' | 'anthropic'): string {
  if (type === 'openai') {
    const choice = (json as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
    const content = choice?.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
    }
    return ''
  }
  const blocks = (json as { content?: { type?: string; text?: string }[] }).content
  if (!Array.isArray(blocks)) return ''
  return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
}

export class VisionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message)
    this.name = 'VisionError'
  }
}

/** 调视觉模型识别一张图片，返回文字描述 */
export async function describeImage(
  cfg: VisionConfig,
  image: ImageInput,
  question?: string,
): Promise<string> {
  let url: string
  let headers: Record<string, string>
  let body: unknown
  if (cfg.type === 'openai') {
    url = openaiUrl(cfg.baseUrl)
    headers = { authorization: `Bearer ${cfg.apiKey}` }
    body = buildOpenAIBody(cfg, image, question)
  } else {
    url = anthropicUrl(cfg.baseUrl)
    headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
    body = buildAnthropicBody(cfg, image, question)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throw new VisionError(
      `连接视觉模型失败: ${(e as Error).message}${(e as Error).name === 'AbortError' ? '（超时）' : ''}`,
    )
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new VisionError(`视觉模型返回 HTTP ${res.status}`, res.status, (await res.text()).slice(0, 500))
  }
  const text = extractText(await res.json(), cfg.type)
  if (!text.trim()) throw new VisionError('视觉模型返回了空描述')
  return text
}
