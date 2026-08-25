import { createHash } from 'node:crypto'
import type { Config } from './config.js'
import {
  assertPublicHttpUrl,
  estimateBase64Bytes,
  isLoopbackHost,
  loadUrlImage,
  prepareImage,
  type ImageInput,
} from './images.js'
import { describeImage } from './vision.js'

// Re-export for backward compatibility (tests / external consumers import from rewrite.js)
export { assertPublicHttpUrl, estimateBase64Bytes, isLoopbackHost } from './images.js'

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
