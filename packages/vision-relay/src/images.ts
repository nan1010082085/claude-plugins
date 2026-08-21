import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const DEFAULT_MAX_IMAGE_BYTES = 100 * 1024 * 1024
export const DEFAULT_TARGET_IMAGE_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_IMAGE_EDGE = 8000
const MIN_KEEP_EDGE = 128
const JPEG_QUALITY_LADDER = [85, 60, 40, 20]

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
    new Error(`图片 ${(n / 1024 / 1024).toFixed(1)}MB 超过硬上限 ${(maxBytes / 1024 / 1024).toFixed(0)}MB（可调 config: vision.maxImageBytes）: ${ref.value}`)
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

/** 不解码读 PNG 尺寸（IHDR 固定偏移），非 PNG 返回 null */
export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

export interface ImageLimits {
  /** 超过则触发压缩（对齐最严格的视觉 API 载荷限制） */
  targetBytes: number
  /** 长边像素上限（长截图常见超限点） */
  maxEdge: number
}

/**
 * 超限图片自动压缩：白底合成 -> 长边约束 -> JPEG q85，
 * 仍超 targetBytes 则分辨率减半重试（下限 256px）。
 * 不超限或无法处理（svg/损坏格式）时原样返回，绝不阻断识别。
 */
export async function prepareImage(image: ImageInput, limits: ImageLimits): Promise<ImageInput> {
  const dims = pngDimensions(image.data)
  const overEdge = dims !== null && Math.max(dims.width, dims.height) > limits.maxEdge
  if (image.data.length <= limits.targetBytes && !overEdge) return image
  try {
    const { Jimp } = await import('jimp')
    const decoded = await Jimp.read(image.data)
    // 透明底合成到白底，避免 JPEG 转码后透明区变黑
    let img = decoded.hasAlpha?.()
      ? new Jimp({ width: decoded.width, height: decoded.height, color: 0xffffffff }).composite(decoded, 0, 0)
      : decoded
    if (Math.max(img.width, img.height) > limits.maxEdge) {
      const scale = limits.maxEdge / Math.max(img.width, img.height)
      img = img.resize({ w: Math.max(1, Math.round(img.width * scale)), h: Math.max(1, Math.round(img.height * scale)) })
    }
    // 质量阶梯降级，到最低档仍超则分辨率减半后回到较高画质重试
    let qi = 0
    let buf = await img.getBuffer('image/jpeg', { quality: JPEG_QUALITY_LADDER[0] })
    while (buf.length > limits.targetBytes) {
      if (qi < JPEG_QUALITY_LADDER.length - 1) {
        qi++
      } else if (Math.max(img.width, img.height) / 2 >= MIN_KEEP_EDGE) {
        img = img.resize({
          w: Math.max(1, Math.round(img.width / 2)),
          h: Math.max(1, Math.round(img.height / 2)),
        })
        qi = 1
      } else {
        break // 尽力了，接受当前结果（远好于直接拒绝）
      }
      buf = await img.getBuffer('image/jpeg', { quality: JPEG_QUALITY_LADDER[qi] })
    }
    // 压缩后反而更大（罕见）则保留原图
    if (buf.length >= image.data.length && !overEdge) return image
    return { data: buf, mediaType: 'image/jpeg', source: image.source }
  } catch {
    // jimp 解不了（svg/损坏等）：原样送出，由视觉 API 决定
    return image
  }
}

/** Claude Code 粘贴图缓存根目录 */
export function claudeImageCacheRoot(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'image-cache')
}

/**
 * 解析 Claude Code `[Image #N]` 对应的落盘路径。
 * 有 sessionId 用该目录；否则取最近更新的会话目录。
 */
export function resolveClaudePastedImagePath(n: number, sessionId?: string): string | null {
  const cacheDir = claudeImageCacheRoot()
  const candidates: string[] = []
  if (sessionId) candidates.push(join(cacheDir, sessionId))
  else {
    try {
      const latest = readdirSync(cacheDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ dir: join(cacheDir, e.name), mtime: statSync(join(cacheDir, e.name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0]
      if (latest) candidates.push(latest.dir)
    } catch {}
  }
  for (const dir of candidates) {
    try {
      const file = readdirSync(dir).find((f) => /^\d+\.[a-z0-9]+$/i.test(f) && f.startsWith(`${n}.`))
      if (file) return join(dir, file)
    } catch {}
  }
  return null
}

/** 读取粘贴缓存为 ImageInput；超 maxBytes 则返回 null */
export function loadClaudePastedImage(n: number, maxBytes: number, sessionId?: string): ImageInput | null {
  const p = resolveClaudePastedImagePath(n, sessionId)
  if (!p) return null
  try {
    const size = statSync(p).size
    if (size > maxBytes) return null
    return {
      data: readFileSync(p),
      mediaType: mediaTypeFor(p) ?? 'image/png',
      source: `粘贴图片 [Image #${n}]`,
    }
  } catch {
    return null
  }
}

/** 从用户输入解析粘贴序号：`#1` / `1` / `[Image #1]` */
export function parsePastedImageRef(raw: string): number | null {
  const s = raw.trim()
  const m = s.match(/^\[Image #(\d+)\]$/i) || s.match(/^#(\d+)$/) || s.match(/^(\d+)$/)
  return m ? Number(m[1]) : null
}
