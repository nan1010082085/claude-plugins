import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024

export interface ImageRef {
  kind: 'path' | 'url'
  value: string
}

export interface ImageInput {
  data: Buffer
  mediaType: string
  source: string
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

const TRAILING_PUNCT = /[.,;:!?)\]}'"。，；：！？）】》’”»]+$/
const TOKEN_RE = /[^\s"'`<>|[\]()]+/g

export function mediaTypeFor(value: string): string | undefined {
  const m = value.split(/[?#]/)[0]!.match(/\.([a-z0-9]+)$/i)
  return m ? MEDIA_TYPES[m[1]!.toLowerCase()] : undefined
}

function expandPath(value: string, cwd: string): string {
  if (value.startsWith('~')) return join(homedir(), value.slice(1))
  if (isAbsolute(value)) return value
  return resolve(cwd, value)
}

/** 从文本中提取图片引用：http(s) URL 与真实存在的本地路径（按 token 扫描，避免误报） */
export function findImageRefs(text: string, cwd: string): ImageRef[] {
  const refs: ImageRef[] = []
  const seen = new Set<string>()
  for (const raw of text.match(TOKEN_RE) ?? []) {
    const token = raw.replace(TRAILING_PUNCT, '')
    if (/^https?:/i.test(token)) {
      if (mediaTypeFor(token) && !seen.has(token)) {
        seen.add(token)
        refs.push({ kind: 'url', value: token })
      }
      continue
    }
    if (!mediaTypeFor(token)) continue
    // 存在性检查兜底：裸文件名（如 shot.png）只要真实存在也算引用
    if (!existsSync(expandPath(token, cwd))) continue
    if (!seen.has(token)) {
      seen.add(token)
      refs.push({ kind: 'path', value: token })
    }
  }
  return refs
}

export async function readImageRef(
  ref: ImageRef,
  cwd: string,
  maxBytes: number = DEFAULT_MAX_IMAGE_BYTES,
): Promise<ImageInput> {
  const mediaType = mediaTypeFor(ref.value)
  if (!mediaType) throw new Error(`无法识别图片类型: ${ref.value}`)
  const sizeError = (n: number): Error =>
    new Error(`图片 ${(n / 1024 / 1024).toFixed(1)}MB 超过上限 ${(maxBytes / 1024 / 1024).toFixed(0)}MB: ${ref.value}`)
  if (ref.kind === 'url') {
    const res = await fetch(ref.value)
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw sizeError(buf.length)
    return {
      data: buf,
      mediaType: res.headers.get('content-type')?.split(';')[0] || mediaType,
      source: ref.value,
    }
  }
  const p = expandPath(ref.value, cwd)
  const size = statSync(p).size
  if (size > maxBytes) throw sizeError(size)
  return { data: readFileSync(p), mediaType, source: p }
}

/** 1x1 红色 PNG，用于测试连接 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export function tinyPng(): ImageInput {
  return { data: Buffer.from(TINY_PNG_BASE64, 'base64'), mediaType: 'image/png', source: 'test' }
}
