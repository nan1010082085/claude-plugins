import { loadConfig, validateConfig } from './config.js'
import { findImageRefs, prepareImage, readImageRef } from './images.js'
import { describeImage } from './vision.js'

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
    try {
      prompt = (JSON.parse(input) as { prompt?: string }).prompt ?? ''
    } catch {
      prompt = input
    }
    const { config } = loadConfig()
    if (!config.hook.enabled) return { additionalContext: null }
    // 配置问题不该阻塞用户会话，静默跳过
    if (validateConfig(config).length) return { additionalContext: null }

    const refs = findImageRefs(prompt, cwd).slice(0, config.hook.maxImages)
    if (!refs.length) return { additionalContext: null }

    // 并行识别：总耗时 = 最慢一张，而非串行累加，避免超过 hook 超时上限
    const results = await Promise.allSettled(
      refs.map(async (ref) => {
        const image = await readImageRef(ref, cwd, config.vision.maxImageBytes)
        const prepared = await prepareImage(image, {
          targetBytes: config.vision.targetImageBytes,
          maxEdge: config.vision.maxImageEdge,
        })
        return describeImage(config.vision, prepared)
      }),
    )
    const parts = refs.map((ref, i) => {
      const r = results[i]!
      return r.status === 'fulfilled'
        ? `[vision-relay 图片 #${i + 1}: ${ref.value}]\n${r.value}`
        : `[vision-relay 图片 #${i + 1}: ${ref.value}] 识别失败: ${(r.reason as Error).message}`
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
