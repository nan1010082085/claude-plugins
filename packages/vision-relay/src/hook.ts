import type { ImageInput } from './images.js'
import { loadConfig, validateConfig } from './config.js'
import {
  findImageRefs,
  loadClaudePastedImage,
  prepareImage,
  readImageRef,
} from './images.js'
import { formatVisionBrief } from './user-info.js'
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

function resolvePastedImage(
  sessionId: string | undefined,
  n: number,
  maxBytes: number,
  transcriptPath?: string,
  cwd?: string,
): ImageInput | null {
  return loadClaudePastedImage(n, maxBytes, sessionId, transcriptPath, cwd)
}

/** 从 stdin JSON 中提取 Claude Code 传入的图片数据（base64 content block） */
function extractInlineImages(parsed: Record<string, unknown>): ImageInput[] {
  const images: ImageInput[] = []
  // 可能的字段：images, content, contentBlocks, message.content
  const message = parsed.message
  const messageContent =
    message && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : undefined
  const candidates = [parsed.images, parsed.content, parsed.contentBlocks, messageContent].filter(
    Array.isArray,
  ) as unknown[][]
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
      // 格式2: Anthropic { type: "image", source: { type: "base64", media_type, data } }
      if (block.type === 'image' && block.source && typeof block.source === 'object') {
        const source = block.source as Record<string, unknown>
        if (source.type === 'base64' && typeof source.data === 'string') {
          const buf = Buffer.from(source.data, 'base64')
          const mt = typeof source.media_type === 'string' ? source.media_type : 'image/png'
          images.push({ data: buf, mediaType: mt, source: 'stdin:anthropic-base64' })
        }
      }
      // 格式3: { type: "image_url", image_url: { url: "data:..." } }
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
    let resolved = false

    const done = () => {
      if (!resolved) {
        resolved = true
        resolve(data)
      }
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', done)
    process.stdin.on('error', done)

    // 如果 stdin 已经结束（readableEnded），立即 resolve
    // 这处理了 Claude Code 在调用 hook 前就关闭 stdin 的情况
    if (process.stdin.readableEnded || process.stdin.destroyed) {
      done()
    }
  })
}

export interface HookResult {
  /** 注入模型的详细描述（用户通常看不到全文） */
  additionalContext: string | null
  /** 展示给用户的简略提示（Claude Code systemMessage） */
  systemMessage: string | null
}

function emptyHook(): HookResult {
  return { additionalContext: null, systemMessage: null }
}

function summarizeResults(
  sources: string[],
  results: PromiseSettledResult<string>[],
  model?: string,
  ms?: number,
): { ok: number; fail: number; systemMessage: string } {
  let ok = 0
  let fail = 0
  for (const r of results) {
    if (r.status === 'fulfilled') ok++
    else fail++
  }
  return {
    ok,
    fail,
    systemMessage: formatVisionBrief({ ok, fail, sources, model, ms }),
  }
}

/**
 * Claude Code UserPromptSubmit hook：扫描 prompt 中的图片路径/URL，
 * 并行调视觉模型，把描述作为 additionalContext 注入对话；
 * 同时用 systemMessage 给用户一行简报（additionalContext 默认不进聊天可见区）。
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
    if (!config.hook.enabled) return emptyHook()
    // 配置问题不该阻塞用户会话，静默跳过
    if (validateConfig(config).length) return emptyHook()

    // 三种图片来源：1) stdin 中的 inline base64 图片 2) [Image #N] 粘贴缓存 3) prompt 中的路径/URL 引用
    const inlineImages = rawParsed ? extractInlineImages(rawParsed) : []
    const refs = findImageRefs(prompt, cwd)
    const started = Date.now()

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
      const sum = summarizeResults(
        limited.map((i) => i.source),
        results,
        config.vision.model,
        Date.now() - started,
      )
      return {
        additionalContext: parts.join('\n\n'),
        systemMessage: sum.systemMessage,
      }
    }

    // [Image #N] 粘贴图片：image-cache → transcript jsonl（cache 常被 Claude 清理）
    const sessionId = typeof rawParsed?.session_id === 'string' ? rawParsed.session_id : undefined
    const transcriptPath =
      typeof rawParsed?.transcript_path === 'string' ? rawParsed.transcript_path : undefined
    const hookCwd = typeof rawParsed?.cwd === 'string' ? rawParsed.cwd : cwd
    const imageNums = detectImageRefNums(prompt)
    const pastedImages = imageNums
      .map((n) => resolvePastedImage(sessionId, n, config.vision.maxImageBytes, transcriptPath, hookCwd))
      .filter((img): img is ImageInput => img !== null)

    // 粘贴图片与路径/URL 引用合并，并行识别：总耗时 = 最慢一张，而非串行累加
    const tasks: Array<{ source: string; load: () => Promise<ImageInput> }> = [
      ...pastedImages.map((img) => ({ source: img.source, load: async () => img })),
      ...refs.map((ref) => ({ source: ref.value, load: () => readImageRef(ref, cwd, config.vision.maxImageBytes) })),
    ].slice(0, config.hook.maxImages)

    if (!tasks.length) {
      // 仅列出未能解析的 [Image #N]（prompt 里可能有历史占位符如 #1，当前轮只有 #4）
      const inlineRefs = detectInlineRefs(prompt)
      const failedImageNums = imageNums.filter(
        (n) => !pastedImages.some((img) => img.source.includes(`[Image #${n}]`)),
      )
      if (failedImageNums.length || inlineRefs.length) {
        const refsLabel = [
          ...failedImageNums.map((n) => `[Image #${n}]`),
          ...inlineRefs,
        ].join('、')
        const hint = [
          `[vision-relay] 用户消息包含内联引用（${refsLabel}），但未能获取其内容。`,
          'image-cache 已清理时，hook 会读 transcript；若仍失败请改用路径或 clipboard：',
          '  /vision ./screenshot.png 这个报错怎么修',
          '  /vision clipboard 看看剪贴板这张图',
        ].join('\n')
        return {
          additionalContext: hint,
          systemMessage: `[vision-relay] ⚠ 未能读取内联图片（${refsLabel}），请改用 /vision <路径|clipboard>`,
        }
      }
      return emptyHook()
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
      const header = task.source.match(/\[Image #\d+\]/)
        ? `[vision-relay ${task.source}]`
        : `[vision-relay 图片 #${i + 1}: ${task.source}]`
      return r.status === 'fulfilled'
        ? `${header}\n${r.value}`
        : `${header} 识别失败: ${(r.reason as Error).message}`
    })
    const sum = summarizeResults(
      tasks.map((t) => t.source),
      results,
      config.vision.model,
      Date.now() - started,
    )
    return {
      additionalContext: parts.join('\n\n'),
      systemMessage: sum.systemMessage,
    }
  } catch {
    return emptyHook()
  }
}

export async function hookMain(): Promise<void> {
  const input = await readStdin()
  const { additionalContext, systemMessage } = await runClaudeCodeHook(input, process.cwd())
  if (!additionalContext && !systemMessage) return
  // systemMessage：用户可见简报；additionalContext：仅注入模型
  const out: Record<string, unknown> = {}
  if (systemMessage) out.systemMessage = systemMessage
  if (additionalContext) {
    out.hookSpecificOutput = {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    }
  }
  process.stdout.write(JSON.stringify(out))
  // 无图片时静默 exit 0，绝不阻塞用户
}
