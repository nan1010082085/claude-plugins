import { loadConfig, validateConfig } from './config.js'
import { findImageRefs, readImageRef } from './images.js'
import { describeImage } from './vision.js'

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
  })
}

export interface HookResult {
  additionalContext: string | null
}

/**
 * Claude Code UserPromptSubmit hook：扫描 prompt 中的图片路径/URL，
 * 逐张调视觉模型，把描述作为 additionalContext 注入对话。单图失败不阻塞。
 */
export async function runClaudeCodeHook(input: string, cwd: string): Promise<HookResult> {
  let prompt = ''
  try {
    prompt = (JSON.parse(input) as { prompt?: string }).prompt ?? ''
  } catch {
    prompt = input
  }
  const { config } = loadConfig()
  if (!config.hook.enabled) return { additionalContext: null }

  const errs = validateConfig(config)
  if (errs.length) {
    // 配置问题不该阻塞用户会话，静默跳过
    return { additionalContext: null }
  }

  const refs = findImageRefs(prompt, cwd).slice(0, config.hook.maxImages)
  const parts: string[] = []
  for (const [i, ref] of refs.entries()) {
    try {
      const image = await readImageRef(ref, cwd)
      const desc = await describeImage(config.vision, image)
      parts.push(
        `[vision-relay 图片 #${i + 1}: ${ref.value}]（已识别，无需再调用 vision_describe）\n${desc}`,
      )
    } catch (e) {
      parts.push(
        `[vision-relay 图片 #${i + 1}: ${ref.value}] 识别失败: ${(e as Error).message}（可尝试用 vision_describe 工具重试）`,
      )
    }
  }
  if (!parts.length) return { additionalContext: null }
  return { additionalContext: parts.join('\n\n') }
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
