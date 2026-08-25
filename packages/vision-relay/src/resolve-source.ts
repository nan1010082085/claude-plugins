import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claudeImageCacheRoot,
  loadClaudePastedImage,
  loadRecentImageFromTranscripts,
  mediaTypeFor,
  parsePastedImageRef,
  readImageRef,
  resolveClaudePastedImagePath,
  type ImageInput,
} from './images.js'
import { codexHome } from './paths.js'

/**
 * 从用户参数解析图片来源（/vision、describe、MCP 共用）。
 * 支持：本地路径、URL、`#N` / `[Image #N]`、`recent`、`clipboard`。
 */
export type SourceKind = 'path' | 'url' | 'pasted' | 'recent' | 'clipboard' | 'base64'

export interface ResolvedSource {
  image: ImageInput
  /** 给人看的来源说明 */
  label: string
  kind: SourceKind
}

function latestFileInDir(dir: string, re: RegExp): string | null {
  if (!existsSync(dir)) return null
  try {
    const files = readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => {
        const p = join(dir, f)
        return { p, m: statSync(p).mtimeMs }
      })
      .sort((a, b) => b.m - a.m)
    return files[0]?.p ?? null
  } catch {
    return null
  }
}

/** Claude image-cache / Codex attachments 中最近一张**文件路径**（不含 transcript） */
export function resolveRecentImagePath(): string | null {
  const cacheRoot = claudeImageCacheRoot()
  const cacheHits: Array<{ p: string; m: number }> = []
  if (existsSync(cacheRoot)) {
    try {
      for (const session of readdirSync(cacheRoot, { withFileTypes: true })) {
        if (!session.isDirectory()) continue
        const dir = join(cacheRoot, session.name)
        for (const f of readdirSync(dir)) {
          if (!/^\d+\.(png|jpe?g|gif|webp|bmp)$/i.test(f)) continue
          const p = join(dir, f)
          try {
            cacheHits.push({ p, m: statSync(p).mtimeMs })
          } catch {}
        }
      }
    } catch {}
  }
  if (cacheHits.length) {
    cacheHits.sort((a, b) => b.m - a.m)
    return cacheHits[0]!.p
  }
  const codexAtt = join(codexHome(), 'attachments')
  if (existsSync(codexAtt)) {
    try {
      const sessions = readdirSync(codexAtt, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ dir: join(codexAtt, e.name), m: statSync(join(codexAtt, e.name)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
      for (const s of sessions) {
        const hit = latestFileInDir(s.dir, /\.(png|jpe?g|gif|webp|bmp)$/i)
        if (hit) return hit
      }
    } catch {}
  }
  return null
}

/** 从系统剪贴板读图（macOS osascript / pngpaste；Linux wl-paste|xclip） */
export function readClipboardImage(maxBytes: number): ImageInput {
  const platform = process.platform
  if (platform === 'darwin') {
    const dir = mkdtempSync(join(tmpdir(), 'vr-clip-'))
    const out = join(dir, 'clip.png')
    try {
      execFileSync('pngpaste', [out], { stdio: 'ignore' })
    } catch {
      const script = `
set outPath to POSIX file "${out}"
try
  set pngData to the clipboard as «class PNGf»
on error
  error "clipboard has no image"
end try
set f to open for access outPath with write permission
set eof f to 0
write pngData to f
close access f
`
      try {
        execFileSync('osascript', ['-e', script], { stdio: 'pipe' })
      } catch {
        throw new Error(
          '剪贴板中没有图片。请先截图或「复制图像」，再调用 source=clipboard / path=clipboard（勿把图粘贴进对话）',
        )
      }
    }
    if (!existsSync(out) || statSync(out).size === 0) {
      throw new Error('剪贴板读图失败（空文件）')
    }
    const size = statSync(out).size
    if (size > maxBytes) throw new Error(`剪贴板图片超过硬上限`)
    return { data: readFileSync(out), mediaType: 'image/png', source: 'clipboard' }
  }
  if (platform === 'linux') {
    const dir = mkdtempSync(join(tmpdir(), 'vr-clip-'))
    const out = join(dir, 'clip.png')
    try {
      execFileSync('sh', ['-c', `wl-paste --type image/png > "${out}" 2>/dev/null || xclip -selection clipboard -t image/png -o > "${out}"`], {
        stdio: 'ignore',
      })
    } catch {
      throw new Error('剪贴板读图失败：需要 wl-paste 或 xclip，且剪贴板中有图片')
    }
    if (!existsSync(out) || statSync(out).size === 0) {
      throw new Error('剪贴板中没有图片')
    }
    if (statSync(out).size > maxBytes) throw new Error('剪贴板图片超过硬上限')
    return { data: readFileSync(out), mediaType: 'image/png', source: 'clipboard' }
  }
  throw new Error(`当前平台 ${platform} 暂不支持 clipboard；请改用本地文件路径`)
}

export interface ResolveImageArgs {
  /** 路径 / URL / #N / recent / clipboard */
  path?: string
  url?: string
  image_data?: string
  media_type?: string
  /** 显式：clipboard | recent */
  source?: string
  cwd?: string
  maxBytes: number
  /** Claude Code hook stdin：会话 transcript jsonl */
  transcriptPath?: string
  sessionId?: string
}

/**
 * 统一解析 MCP / CLI 图片参数。
 * 优先级：image_data → source/path 别名(clipboard|recent|#N) → url → path 文件。
 */
export async function resolveImageInput(args: ResolveImageArgs): Promise<ResolvedSource> {
  const cwd = args.cwd ?? process.cwd()
  const maxBytes = args.maxBytes

  if (args.image_data) {
    const buf = Buffer.from(args.image_data, 'base64')
    if (buf.length > maxBytes) throw new Error('image_data 超过硬上限')
    const inferred =
      args.media_type ||
      (buf[0] === 0x89 && buf[1] === 0x50
        ? 'image/png'
        : buf[0] === 0xff && buf[1] === 0xd8
          ? 'image/jpeg'
          : buf[0] === 0x47 && buf[1] === 0x49
            ? 'image/gif'
            : buf[0] === 0x52 && buf[1] === 0x49
              ? 'image/webp'
              : 'image/png')
    return {
      image: { data: buf, mediaType: inferred, source: 'base64' },
      label: 'image_data',
      kind: 'base64',
    }
  }

  const raw = (args.source || args.path || args.url || '').trim()
  if (!raw && !args.url) {
    throw new Error(
      '必须提供 path、url、image_data，或 source=clipboard|recent|#N。' +
        '不要把图粘贴进对话；截图后用 path=clipboard 或先存成文件再传路径。',
    )
  }

  const alias = (args.source || args.path || '').trim().toLowerCase()
  if (alias === 'clipboard' || alias === 'clip' || alias === 'pasteboard') {
    const image = readClipboardImage(maxBytes)
    return { image, label: 'clipboard', kind: 'clipboard' }
  }
  if (alias === 'recent' || alias === 'latest') {
    const p = resolveRecentImagePath()
    if (p) {
      const image = await readImageRef({ kind: 'path', value: p }, cwd, maxBytes)
      return { image, label: `recent → ${p}`, kind: 'recent' }
    }
    const fromTranscript = loadRecentImageFromTranscripts(maxBytes, args.transcriptPath)
    if (fromTranscript) {
      return { image: fromTranscript, label: fromTranscript.source, kind: 'recent' }
    }
    throw new Error(
      '未找到 recent 图片（无 image-cache / transcript / Codex attachments）。请改用文件路径或 path=clipboard',
    )
  }

  const pasted = parsePastedImageRef(args.path || args.source || '')
  if (pasted !== null) {
    const cached = resolveClaudePastedImagePath(pasted)
    if (cached) {
      const image = await readImageRef({ kind: 'path', value: cached }, cwd, maxBytes)
      return { image, label: `[Image #${pasted}] → ${cached}`, kind: 'pasted' }
    }
    const fromTranscript = loadClaudePastedImage(
      pasted,
      maxBytes,
      args.sessionId,
      args.transcriptPath,
      cwd,
    )
    if (fromTranscript) {
      return { image: fromTranscript, label: fromTranscript.source, kind: 'pasted' }
    }
    throw new Error(
      `未找到粘贴缓存 [Image #${pasted}]（image-cache 已清理且 transcript 无匹配）。请用文件路径，或 path=recent / path=clipboard`,
    )
  }

  if (args.url || /^https?:\/\//i.test(raw)) {
    const value = args.url || raw
    const image = await readImageRef({ kind: 'url', value }, cwd, maxBytes)
    return { image, label: value, kind: 'url' }
  }

  const image = await readImageRef({ kind: 'path', value: raw }, cwd, maxBytes)
  return { image, label: image.source, kind: 'path' }
}

/** 供测试：写入假缓存文件 */
export function writeTempPng(path: string, data: Buffer): void {
  writeFileSync(path, data)
  if (!mediaTypeFor(path)) {
    /* ignore */
  }
}
