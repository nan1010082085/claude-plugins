import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pc from 'picocolors'
import { loadConfig, validateConfig } from './config.js'
import { claudeSettingsPath, isWindows } from './paths.js'
import { isLoopbackHost } from './rewrite.js'
import { startSessionProxy } from './session-proxy.js'

/** 判断 URL 是否指向本机（含旧版常驻代理残留、IPv4-mapped） */
export function isLoopbackBaseUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * 解析 Claude Code 当前编码上游。
 * 优先级：进程环境 → ~/.claude/settings.json env（cc-switch 常写这里）。
 * 不修改任何磁盘配置。
 */
export function resolveClaudeUpstream(env: NodeJS.ProcessEnv = process.env): {
  upstream: string
  source: 'env' | 'settings'
} {
  const fromEnv = env.ANTHROPIC_BASE_URL?.trim()
  if (fromEnv && !isLoopbackBaseUrl(fromEnv)) {
    return { upstream: fromEnv.replace(/\/+$/, ''), source: 'env' }
  }

  const settingsPath = claudeSettingsPath()
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        env?: Record<string, string>
      }
      const fromSettings = settings.env?.ANTHROPIC_BASE_URL?.trim()
      if (fromSettings && !isLoopbackBaseUrl(fromSettings)) {
        return { upstream: fromSettings.replace(/\/+$/, ''), source: 'settings' }
      }
      if (fromSettings && isLoopbackBaseUrl(fromSettings)) {
        throw new Error(
          `settings 中 ANTHROPIC_BASE_URL 已指向本机 (${fromSettings})。` +
            `请用 cc-switch 恢复真实编码上游后再运行 vision-relay claude`,
        )
      }
    } catch (e) {
      if ((e as Error).message.includes('ANTHROPIC_BASE_URL')) throw e
      throw new Error(`读取 ${settingsPath} 失败: ${(e as Error).message}`)
    }
  }

  if (fromEnv && isLoopbackBaseUrl(fromEnv)) {
    throw new Error(
      `环境变量 ANTHROPIC_BASE_URL 指向本机 (${fromEnv})，无法作为上游。请先恢复 cc-switch / 真实上游`,
    )
  }

  throw new Error(
    '未找到可用的 ANTHROPIC_BASE_URL（环境变量或 ~/.claude/settings.json）。请先用 cc-switch 配置编码模型上游',
  )
}

/** 会话包装启动前检查项（供 doctor / claude 命令共用） */
export function checkClaudeWrapReady(env: NodeJS.ProcessEnv = process.env): {
  ok: boolean
  items: Array<{ label: string; ok: boolean; detail?: string }>
} {
  const items: Array<{ label: string; ok: boolean; detail?: string }> = []

  const { config, exists } = loadConfig()
  items.push({
    label: '视觉配置文件',
    ok: exists,
    detail: exists ? undefined : '运行 vision-relay init',
  })

  const errs = exists ? validateConfig(config) : ['配置不存在']
  items.push({
    label: '视觉配置完整',
    ok: errs.length === 0,
    detail: errs.length ? errs.join('; ') : `${config.vision.model} @ ${config.vision.baseUrl}`,
  })

  let upstreamOk = false
  let upstreamDetail: string | undefined
  try {
    const { upstream, source } = resolveClaudeUpstream(env)
    upstreamOk = true
    upstreamDetail = `${upstream}（来源: ${source}）`
  } catch (e) {
    upstreamDetail = (e as Error).message
  }
  items.push({ label: '编码上游 ANTHROPIC_BASE_URL', ok: upstreamOk, detail: upstreamDetail })

  const claudeBin = env.VISION_RELAY_CLAUDE_BIN || 'claude'
  items.push({
    label: 'claude 启动命令',
    ok: true,
    detail: `${claudeBin}（PATH 或 VISION_RELAY_CLAUDE_BIN；启动失败时再报错）`,
  })

  const hard = items.filter((i) => i.label !== 'claude 启动命令')
  return { ok: hard.every((i) => i.ok), items }
}

/**
 * 会话覆盖 JSON 内容（不直接塞进 CLI：Windows/Git Bash 会把内联 JSON 拆坏）。
 */
export function buildSessionSettingsOverride(proxyBaseUrl: string): string {
  return JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: proxyBaseUrl,
      },
    },
    null,
    2,
  )
}

/**
 * 写入临时 settings 文件，供 `claude --settings <file>` 使用。
 * 不碰 ~/.claude/settings.json；调用方负责在退出后删除。
 */
export function writeSessionSettingsFile(proxyBaseUrl: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vr-claude-'))
  const file = join(dir, 'settings.json')
  writeFileSync(file, `${buildSessionSettingsOverride(proxyBaseUrl)}\n`, 'utf8')
  return file
}

/** 组装启动参数：`--settings <临时文件>` + 用户参数 */
export function buildClaudeArgv(settingsFile: string, userArgs: string[]): string[] {
  return ['--settings', settingsFile, ...userArgs]
}

function cleanupSettingsFile(file: string): void {
  try {
    rmSync(join(file, '..'), { recursive: true, force: true })
  } catch {
    try {
      rmSync(file, { force: true })
    } catch {}
  }
}

/**
 * 启动会话改写并拉起 Claude Code。
 * - 不写 ~/.claude/settings.json（临时 --settings 文件）
 * - 不改模型名 / token / cc-switch 磁盘配置
 * - 出站经本机改写 → 原上游
 */
export async function runClaudeWrapped(claudeArgs: string[] = []): Promise<number> {
  const ready = checkClaudeWrapReady()
  if (!ready.ok) {
    console.error(pc.red('vision-relay claude 启动前检查未通过：'))
    for (const i of ready.items) {
      if (!i.ok) console.error(pc.red(`  ✗ ${i.label}${i.detail ? ` — ${i.detail}` : ''}`))
    }
    return 1
  }

  const { config } = loadConfig()
  const { upstream, source } = resolveClaudeUpstream()
  const proxy = await startSessionProxy({ config, upstreamBaseUrl: upstream })

  // 只通过环境变量传递 ANTHROPIC_BASE_URL，不使用 --settings 文件。
  // --settings 文件会触发 Claude Code 的 security consent dialog（每次临时路径不同，无法记住信任）。
  // 环境变量方式等效且不会弹出确认对话框。
  console.error(pc.dim(`vision-relay 会话改写: ${proxy.baseUrl}`))
  console.error(pc.dim(`编码上游（${source}）: ${upstream}`))
  console.error('')

  const bin = process.env.VISION_RELAY_CLAUDE_BIN || 'claude'
  const childEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: proxy.baseUrl,
  }

  const exitCode = await new Promise<number>((resolve) => {
    // Windows 上 shell:true 会拆坏内联 JSON；现已改用文件路径，仍可用 shell 解析 PATH 里的 .cmd
    const child = spawn(bin, claudeArgs, {
      env: childEnv,
      stdio: 'inherit',
      shell: isWindows(),
      windowsHide: true,
    })
    const shutdown = async (code: number) => {
      try {
        await proxy.close()
      } catch {}
      resolve(code)
    }
    child.on('error', async (err) => {
      console.error(pc.red(`无法启动 ${bin}: ${err.message}`))
      await shutdown(1)
    })
    child.on('exit', (code, signal) => {
      void shutdown(code ?? (signal ? 1 : 0))
    })
    const onSignal = (sig: NodeJS.Signals) => {
      try {
        child.kill(sig)
      } catch {}
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  })

  return exitCode
}
