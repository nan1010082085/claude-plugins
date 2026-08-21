import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pc from 'picocolors'
import { configPath, loadConfig, validateConfig } from './config.js'
import { detectTerminals, TERMINAL_LABELS, type TerminalId } from './setup.js'
import { checkClaudeWrapReady, isLoopbackBaseUrl } from './wrap-claude.js'

interface WiringResult {
  ok: boolean
  /** 每条接线一个明细：文案 + 是否命中 */
  details: Array<{ label: string; ok: boolean; path: string }>
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function wiring(t: TerminalId): WiringResult {
  if (t === 'claude-code') {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    const hookHit = readText(settingsPath).includes('vision-relay')
    const mcpPath = join(homedir(), '.claude.json')
    let mcpHit = false
    try {
      const mcp = JSON.parse(readText(mcpPath) || '{}')
      mcpHit = 'vision-relay' in (mcp.mcpServers ?? {})
    } catch {}
    const cmdPath = join(homedir(), '.claude', 'commands', 'vision.md')
    return {
      ok: hookHit,
      details: [
        { label: 'hook (UserPromptSubmit)', ok: hookHit, path: settingsPath },
        { label: 'MCP (user 作用域)', ok: mcpHit, path: mcpPath },
        { label: '/vision 命令', ok: existsSync(cmdPath), path: cmdPath },
      ],
    }
  }
  if (t === 'codex') {
    const tomlPath = join(homedir(), '.codex', 'config.toml')
    const hooksPath = join(homedir(), '.codex', 'hooks.json')
    const cmdPath = join(homedir(), '.codex', 'prompts', 'vision.md')
    const mcpHit = readText(tomlPath).includes('[mcp_servers.vision-relay]')
    const hookHit = readText(hooksPath).includes('vision-relay')
    return {
      ok: mcpHit,
      details: [
        { label: 'MCP server', ok: mcpHit, path: tomlPath },
        { label: 'hook (UserPromptSubmit)', ok: hookHit, path: hooksPath },
        { label: '/vision 命令', ok: existsSync(cmdPath), path: cmdPath },
      ],
    }
  }
  if (t === 'cursor') {
    const mcpPath = join(homedir(), '.cursor', 'mcp.json')
    let mcpHit = false
    try {
      const config = JSON.parse(readText(mcpPath) || '{}')
      mcpHit = 'vision-relay' in (config.mcpServers ?? {})
    } catch {}
    return {
      ok: mcpHit,
      details: [{ label: 'MCP server', ok: mcpHit, path: mcpPath }],
    }
  }
  // opencode
  const configPath = join(homedir(), '.config', 'opencode', 'opencode.json')
  const cmdPath = join(homedir(), '.config', 'opencode', 'command', 'vision.md')
  let mcpHit = false
  try {
    const config = JSON.parse(readText(configPath) || '{}')
    mcpHit = 'vision-relay' in (config.mcp ?? {})
  } catch {}
  return {
    ok: mcpHit,
    details: [
      { label: 'MCP server', ok: mcpHit, path: configPath },
      { label: '/vision 命令', ok: existsSync(cmdPath), path: cmdPath },
    ],
  }
}

function check(label: string, ok: boolean, detail?: string): void {
  const mark = ok ? pc.green('✓') : pc.yellow('!')
  console.log(`  ${mark} ${label}${detail ? pc.dim(` - ${detail}`) : ''}`)
}

export async function doctor(): Promise<void> {
  console.log(pc.bold('vision-relay doctor\n'))

  console.log(pc.bold('环境'))
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  console.log(`  版本      ${version}`)
  console.log(`  Node      ${process.version}`)

  console.log(pc.bold('\n配置'))
  try {
    const { config, exists } = loadConfig()
    check('配置文件', exists, exists ? configPath() : '未创建，运行 vision-relay init')
    if (exists) {
      const errs = validateConfig(config)
      check('配置完整', errs.length === 0, errs.join('; ') || undefined)
      if (errs.length === 0) {
        console.log(
          `  ${pc.dim(`视觉模型: ${config.vision.type} / ${config.vision.model} @ ${config.vision.baseUrl}`)}`,
        )
      }
    }
  } catch (e) {
    check('配置文件', false, (e as Error).message)
  }

  console.log(pc.bold('\n终端接线'))
  const detected = detectTerminals()
  if (!detected.length) console.log(pc.dim('  未检测到 claude / codex / opencode / cursor'))
  for (const t of detected) {
    const w = wiring(t)
    check(TERMINAL_LABELS[t], w.ok, w.ok ? '主通道已接线' : '运行 vision-relay setup')
    for (const d of w.details) {
      const mark = d.ok ? pc.green('✓') : pc.yellow('·')
      console.log(`      ${mark} ${pc.dim(`${d.label}: ${d.path}`)}`)
    }
  }

  console.log(pc.bold('\n会话包装（vision-relay claude）'))
  console.log(
    pc.dim('  对话内粘贴改写：临时 ANTHROPIC_BASE_URL→本机，不写 settings / 不改 cc-switch 模型'),
  )
  const wrap = checkClaudeWrapReady()
  for (const i of wrap.items) {
    check(i.label, i.ok, i.detail)
  }
  // 残留本机 BASE_URL 警告（旧常驻代理）
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        env?: Record<string, string>
      }
      const base = settings.env?.ANTHROPIC_BASE_URL
      if (base && isLoopbackBaseUrl(base)) {
        check(
          'settings 无本机 BASE_URL 残留',
          false,
          `${base} — 请用 cc-switch 恢复真实上游，否则包装无法启动`,
        )
      } else if (base) {
        check('settings BASE_URL 非本机', true, base)
      }
    }
  } catch {}
  if (wrap.ok) {
    console.log(pc.dim('\n  用法: vision-relay claude   # 然后在对话里粘贴图片'))
  }
}
