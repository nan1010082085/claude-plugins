import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isIP } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import { claudeConfigDir, userHome } from './paths.js'

/** Claude projects 目录下 cwd 编码：`/Users/foo/bar` → `-Users-foo-bar` */
export function encodeClaudeProjectKey(cwd: string): string {
  return resolve(cwd).replace(/\//g, '-')
}

/** 会话 transcript 默认路径（hook stdin 未带 transcript_path 时的兜底） */
export function claudeProjectTranscriptPath(sessionId: string, cwd: string): string {
  return join(claudeConfigDir(), 'projects', encodeClaudeProjectKey(cwd), `${sessionId}.jsonl`)
}

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

/** 是否为本机 / 回环（含 IPv4-mapped、方括号 IPv6）。不含一般私网。 */
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

/** 安全下载图片：SSRF 检查 + 超时 + 流式大小限制 */
export async function loadUrlImage(url: string, maxBytes: number, timeoutMs: number): Promise<ImageInput> {
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
  if (value.startsWith('~')) return join(userHome(), value.slice(1))
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
  timeoutMs: number = 30_000,
): Promise<ImageInput> {
  const mediaType = mediaTypeFor(ref.value)
  if (!mediaType) throw new Error(`无法识别图片类型: ${ref.value}`)
  if (ref.kind === 'url') {
    return loadUrlImage(ref.value, maxBytes, timeoutMs)
  }
  const p = expandPath(ref.value, cwd)
  const size = statSync(p).size
  if (size > maxBytes) {
    throw new Error(
      `图片 ${(size / 1024 / 1024).toFixed(1)}MB 超过硬上限 ${(maxBytes / 1024 / 1024).toFixed(0)}MB（可调 config: vision.maxImageBytes）: ${ref.value}`,
    )
  }
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
  return join(claudeConfigDir(), 'image-cache')
}

/** 从 Anthropic / Claude Code content block 抽出图片（与 rewrite.imageFromBlock 对齐） */
function imageFromContentBlock(block: Record<string, unknown>, maxBytes: number): ImageInput | null {
  const type = block.type
  if (type === 'image') {
    const source = block.source
    if (source && typeof source === 'object') {
      const s = source as Record<string, unknown>
      if (s.type === 'base64' && typeof s.data === 'string') {
        const data = Buffer.from(s.data, 'base64')
        if (data.length > maxBytes) return null
        const mt = typeof s.media_type === 'string' ? s.media_type : 'image/png'
        return { data, mediaType: mt, source: 'transcript:base64' }
      }
    }
    if (block.file && typeof block.file === 'object') {
      const file = block.file as Record<string, unknown>
      if (typeof file.base64 === 'string') {
        const data = Buffer.from(file.base64, 'base64')
        if (data.length > maxBytes) return null
        const mt = typeof file.type === 'string' ? file.type : 'image/png'
        return { data, mediaType: mt, source: 'transcript:file' }
      }
    }
  }
  if (type === 'image_url' && block.image_url && typeof block.image_url === 'object') {
    const url = (block.image_url as Record<string, unknown>).url
    if (typeof url === 'string' && url.startsWith('data:')) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/i)
      if (!m) return null
      const data = Buffer.from(m[2]!, 'base64')
      if (data.length > maxBytes) return null
      return { data, mediaType: m[1]!, source: 'transcript:data-uri' }
    }
  }
  return null
}

function firstImageInContent(content: unknown, maxBytes: number): ImageInput | null {
  if (!Array.isArray(content)) return null
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue
    const img = imageFromContentBlock(raw as Record<string, unknown>, maxBytes)
    if (img) return img
  }
  return null
}

interface TranscriptImageHit {
  image: ImageInput
  ts: number
  pasteId?: number
}

/** 解析 transcript jsonl 单行 */
function parseTranscriptLine(line: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(line) as Record<string, unknown>
    return j && typeof j === 'object' ? j : null
  } catch {
    return null
  }
}

function transcriptTimestamp(entry: Record<string, unknown>): number {
  const t = entry.timestamp
  if (typeof t === 'string') {
    const ms = Date.parse(t)
    if (!Number.isNaN(ms)) return ms
  }
  return 0
}

/** 扫描 transcript 中所有用户图片（按时间排序） */
function collectTranscriptImages(transcriptPath: string, maxBytes: number): TranscriptImageHit[] {
  if (!existsSync(transcriptPath)) return []
  const hits: TranscriptImageHit[] = []
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      const entry = parseTranscriptLine(line)
      if (!entry || entry.type !== 'user') continue
      const message = entry.message
      if (!message || typeof message !== 'object') continue
      const content = (message as Record<string, unknown>).content
      const img = firstImageInContent(content, maxBytes)
      if (!img) continue
      const pasteIds = Array.isArray(entry.imagePasteIds)
        ? (entry.imagePasteIds as number[]).filter((n) => Number.isFinite(n))
        : []
      hits.push({
        image: img,
        ts: transcriptTimestamp(entry),
        pasteId: pasteIds[0],
      })
    }
  } catch {
    return []
  }
  hits.sort((a, b) => a.ts - b.ts)
  return hits
}

/**
 * 从 transcript jsonl 读取 `[Image #N]` 对应图片（image-cache 被清理后的兜底）。
 * 优先匹配 `imagePasteIds`；否则匹配同条消息文本中的 `[Image #N]`。
 */
export function loadPastedImageFromTranscript(
  transcriptPath: string,
  n: number,
  maxBytes: number,
): ImageInput | null {
  if (!existsSync(transcriptPath)) return null
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n')
    let fallback: ImageInput | null = null
    for (const line of lines) {
      if (!line.trim()) continue
      const entry = parseTranscriptLine(line)
      if (!entry || entry.type !== 'user') continue
      const message = entry.message
      if (!message || typeof message !== 'object') continue
      const content = (message as Record<string, unknown>).content
      const img = firstImageInContent(content, maxBytes)
      if (!img) continue
      const pasteIds = Array.isArray(entry.imagePasteIds) ? (entry.imagePasteIds as number[]) : []
      if (pasteIds.includes(n)) {
        return { ...img, source: `粘贴图片 [Image #${n}]（transcript）` }
      }
      const textParts = Array.isArray(content)
        ? content
            .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
            .map((b) => String((b as { text?: string }).text ?? ''))
            .join('\n')
        : typeof content === 'string'
          ? content
          : ''
      if (textParts.includes(`[Image #${n}]`) && !fallback) {
        fallback = { ...img, source: `粘贴图片 [Image #${n}]（transcript）` }
      }
    }
    return fallback
  } catch {
    return null
  }
}

/** 列出 `~/.claude/projects` 下全部 transcript（按文件 mtime 新→旧） */
function listTranscriptPaths(): string[] {
  const root = join(claudeConfigDir(), 'projects')
  if (!existsSync(root)) return []
  const out: Array<{ p: string; m: number }> = []
  try {
    for (const project of readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const dir = join(root, project.name)
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue
        const p = join(dir, f)
        try {
          out.push({ p, m: statSync(p).mtimeMs })
        } catch {}
      }
    }
  } catch {
    return []
  }
  out.sort((a, b) => b.m - a.m)
  return out.map((x) => x.p)
}

/** transcript 中最近一张用户粘贴图 */
export function loadRecentImageFromTranscripts(maxBytes: number, preferPath?: string): ImageInput | null {
  const paths = preferPath && existsSync(preferPath) ? [preferPath] : listTranscriptPaths()
  let best: { image: ImageInput; ts: number; path: string } | null = null
  for (const p of paths) {
    for (const hit of collectTranscriptImages(p, maxBytes)) {
      if (!best || hit.ts > best.ts) {
        best = { image: hit.image, ts: hit.ts, path: p }
      }
    }
  }
  if (!best) return null
  return { ...best.image, source: `recent transcript → ${best.path}` }
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

/**
 * 读取粘贴图为 ImageInput。
 * 顺序：image-cache → transcript jsonl（Claude 常清理 cache，但 transcript 仍含 base64）。
 */
export function loadClaudePastedImage(
  n: number,
  maxBytes: number,
  sessionId?: string,
  transcriptPath?: string,
  cwd?: string,
): ImageInput | null {
  const p = resolveClaudePastedImagePath(n, sessionId)
  if (p) {
    try {
      const size = statSync(p).size
      if (size <= maxBytes) {
        return {
          data: readFileSync(p),
          mediaType: mediaTypeFor(p) ?? 'image/png',
          source: `粘贴图片 [Image #${n}]`,
        }
      }
    } catch {}
  }
  const candidates = [
    transcriptPath,
    sessionId && cwd ? claudeProjectTranscriptPath(sessionId, cwd) : undefined,
  ].filter((x): x is string => typeof x === 'string' && x.length > 0)
  for (const tp of candidates) {
    const fromTranscript = loadPastedImageFromTranscript(tp, n, maxBytes)
    if (fromTranscript) return fromTranscript
  }
  return null
}

/** 从用户输入解析粘贴序号：`#1` / `1` / `[Image #1]` */
export function parsePastedImageRef(raw: string): number | null {
  const s = raw.trim()
  const m = s.match(/^\[Image #(\d+)\]$/i) || s.match(/^#(\d+)$/) || s.match(/^(\d+)$/)
  return m ? Number(m[1]) : null
}
