import type { ImageInput } from './images.js'
import { loadConfig, validateConfig } from './config.js'
import {
  findImageRefs,
  loadClaudePastedImage,
  prepareImage,
  readImageRef,
} from './images.js'
import { describeImage } from './vision.js'

/** 检测 prompt 中的 [Pasted text #N] / [Audio #N] 等无法解析的内联引用（不含 Image） */
const INLINE_REF_RE = /\[(?:Pasted text|Audio|\.\.\.Truncated text) #\d+(?: \+\d+ lines)?\.?\]/gi

function detectInlineRefs(prompt: string): string[] {
  return [...new Set(prompt.match(INLINE_REF_RE) ?? [])]
}

/** [Image #N] 占位符：Claude Code 把粘贴图片落盘在 image-cache/<session_id>/N.png */
const IMAGE_REF_RE = /\[Image #(\d+)(?: \+\d+ lines)?\.?\]/gi

function detectImageRefNums(prompt: string): number[] {
  return [...new Set([...prompt.matchAll(IMAGE_REF_RE)].map((m) => Number(m[1])))]
}

function resolvePastedImage(sessionId: string | undefined, n: number, maxBytes: number): ImageInput | null {
  return loadClaudePastedImage(n, maxBytes, sessionId)
}

/** 从 stdin JSON 中提取 Claude Code 传入的图片数据（base64 content block） */
function extractInlineImages(parsed: Record<string, unknown>): ImageInput[] {
  const images: ImageInput[] = []
  // 可能的字段：images, content, contentBlocks
  const candidates = [parsed.images, parsed.content, parsed.contentBlocks].filter(Array.isArray) as unknown[][]
  for (const arr of candidates) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const block = item as Record<string, unknown>
      // 格式1: { type: "image", file: { base64, type, ... } }
      if (block.type === 'image' && block.file && typeof block.file === 'object') {
        const file = block.file as Record<string, unknown>
        if (typeof file.base64 === 'string') {
          const buf = Buffer.from(file.base64, 'base64')
          const mt = typeof file.type === 'string' ? file.type : 'image/png'
          images.push({ data: buf, mediaType: mt, source: 'stdin:image' })
        }
      }
      // 格式2: { type: "image_url", image_url: { url: "data:..." } }
      if (block.type === 'image_url' && block.image_url && typeof block.image_url === 'object') {
        const imgUrl = (block.image_url as Record<string, unknown>).url
        if (typeof imgUrl === 'string' && imgUrl.startsWith('data:')) {
          const match = imgUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (match) {
            images.push({ data: Buffer.from(match[2], 'base64'), mediaType: match[1], source: 'stdin:data-uri' })
          }
        }
      }
    }
  }
  return images
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

export interface HookResult {
  additionalContext: string | null
}

/**
 * Claude Code UserPromptSubmit hook：扫描 prompt 中的图片路径/URL，
 * 并行调视觉模型，把描述作为 additionalContext 注入对话。
 * 铁律：hook 永不抛错、永不阻塞用户会话（任何内部失败都静默降级）。
 */
export async function runClaudeCodeHook(input: string, cwd: string): Promise<HookResult> {
  try {
    let prompt = ''
    let rawParsed: Record<string, unknown> | null = null
    try {
      rawParsed = JSON.parse(input) as Record<string, unknown>
      prompt = (rawParsed as { prompt?: string }).prompt ?? ''
    } catch {
      prompt = input
    }
    // 诊断日志：记录 stdin 结构（仅 VISION_RELAY_DEBUG=1 时）
    if (process.env.VISION_RELAY_DEBUG) {
      const keys = rawParsed ? Object.keys(rawParsed) : []
      const structure = rawParsed
        ? Object.fromEntries(keys.map((k) => [k, typeof rawParsed![k] === 'object' ? (Array.isArray(rawParsed![k]) ? `array[${(rawParsed![k] as unknown[]).length}]` : 'object') : typeof rawParsed![k]]))
        : {}
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const logDir = '/tmp/vision-relay-debug'
      try { mkdirSync(logDir, { recursive: true }) } catch {}
      writeFileSync(`${logDir}/hook-stdin.json`, JSON.stringify(rawParsed ?? input, null, 2).slice(0, 50_000))
      writeFileSync(`${logDir}/hook-structure.json`, JSON.stringify(structure, null, 2))
    }
    const { config } = loadConfig()
    if (!config.hook.enabled) return { additionalContext: null }
    // 配置问题不该阻塞用户会话，静默跳过
    if (validateConfig(config).length) return { additionalContext: null }

    // 三种图片来源：1) stdin 中的 inline base64 图片 2) [Image #N] 粘贴缓存 3) prompt 中的路径/URL 引用
    const inlineImages = rawParsed ? extractInlineImages(rawParsed) : []
    const refs = findImageRefs(prompt, cwd)

    // stdin 有 inline 图片时，直接用 base64 数据
    if (inlineImages.length) {
      const limited = inlineImages.slice(0, config.hook.maxImages)
      const results = await Promise.allSettled(
        limited.map(async (image) => {
          const prepared = await prepareImage(image, {
            targetBytes: config.vision.targetImageBytes,
            maxEdge: config.vision.maxImageEdge,
          })
          return describeImage(config.vision, prepared)
        }),
      )
      const parts = limited.map((img, i) => {
        const r = results[i]!
        return r.status === 'fulfilled'
          ? `[vision-relay 图片 #${i + 1}: ${img.source}]\n${r.value}`
          : `[vision-relay 图片 #${i + 1}: ${img.source}] 识别失败: ${(r.reason as Error).message}`
      })
      return { additionalContext: parts.join('\n\n') }
    }

    // [Image #N] 粘贴图片：从 image-cache 读取，用户粘贴即可用，无需任何额外操作
    const sessionId = typeof rawParsed?.session_id === 'string' ? rawParsed.session_id : undefined
    const imageNums = detectImageRefNums(prompt)
    const pastedImages = imageNums
      .map((n) => resolvePastedImage(sessionId, n, config.vision.maxImageBytes))
      .filter((img): img is ImageInput => img !== null)

    // 粘贴图片与路径/URL 引用合并，并行识别：总耗时 = 最慢一张，而非串行累加
    const tasks: Array<{ source: string; load: () => Promise<ImageInput> }> = [
      ...pastedImages.map((img) => ({ source: img.source, load: async () => img })),
      ...refs.map((ref) => ({ source: ref.value, load: () => readImageRef(ref, cwd, config.vision.maxImageBytes) })),
    ].slice(0, config.hook.maxImages)

    if (!tasks.length) {
      // 粘贴图片缓存缺失（会话已清理/过期）或其他无法解析的内联引用时才提示
      const inlineRefs = detectInlineRefs(prompt)
      if (imageNums.length || inlineRefs.length) {
        const hint = [
          `[vision-relay] 用户消息包含内联引用（${[...imageNums.map((n) => `[Image #${n}]`), ...inlineRefs].join('、')}），但未能获取其内容。`,
          '粘贴图片的缓存已失效时，可让用户改用图片文件路径或 URL 重新发送，例如：',
          '  /vision ./screenshot.png 这个报错怎么修',
        ].join('\n')
        return { additionalContext: hint }
      }
      return { additionalContext: null }
    }

    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        const image = await task.load()
        const prepared = await prepareImage(image, {
          targetBytes: config.vision.targetImageBytes,
          maxEdge: config.vision.maxImageEdge,
        })
        return describeImage(config.vision, prepared)
      }),
    )
    const parts = tasks.map((task, i) => {
      const r = results[i]!
      return r.status === 'fulfilled'
        ? `[vision-relay 图片 #${i + 1}: ${task.source}]\n${r.value}`
        : `[vision-relay 图片 #${i + 1}: ${task.source}] 识别失败: ${(r.reason as Error).message}`
    })
    return { additionalContext: parts.join('\n\n') }
  } catch {
    return { additionalContext: null }
  }
}

export async function hookMain(): Promise<void> {
  const input = await readStdin()
  const { additionalContext } = await runClaudeCodeHook(input, process.cwd())
  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
      }),
    )
  }
  // 无图片或失败时静默 exit 0，绝不阻塞用户
}
