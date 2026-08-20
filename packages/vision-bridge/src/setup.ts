import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'

export type TerminalId = 'claude-code' | 'codex' | 'opencode'

export interface ResolvedCommand {
  command: string
  args: string[]
}

/** 优先全局 vision-bridge，不可用则回退 npx */
export function resolveCommand(sub: string): ResolvedCommand {
  const ok = spawnSync('vision-bridge', ['--version'], { shell: process.platform === 'win32' })
  if (ok.status === 0) return { command: 'vision-bridge', args: [sub] }
  return { command: 'npx', args: ['-y', 'vision-bridge', sub] }
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

function writeIfAbsent(path: string, content: string): boolean {
  if (existsSync(path)) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return true
}

const VISION_COMMAND_MD = `---
description: 用视觉模型识别图片（vision-bridge）
---
请使用 vision_describe 工具识别图片：$ARGUMENTS

拿到识别结果后，结合描述内容回答我的问题。
如果参数中没有图片路径或 URL，请提醒我先提供（例如 /vision ./screenshots/error.png 这个报错是什么原因）。
`

// ---------- Claude Code ----------

export function setupClaudeCode(): string[] {
  const log: string[] = []
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  const settings = readJson(settingsPath)
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  const hookCmd = resolveCommand('hook')
  const entries = Array.isArray(hooks['UserPromptSubmit']) ? hooks['UserPromptSubmit'] : []
  const already = JSON.stringify(entries).includes('vision-bridge')
  if (!already) {
    hooks['UserPromptSubmit'] = [
      ...entries,
      { hooks: [{ type: 'command', command: `${hookCmd.command} ${hookCmd.args.join(' ')}` }] },
    ]
    settings.hooks = hooks
    writeJson(settingsPath, settings)
    log.push(`UserPromptSubmit hook -> ${settingsPath}`)
  }

  // MCP：优先用 claude CLI 注册（user 作用域）
  const mcp = resolveCommand('mcp')
  const claude = spawnSync(
    'claude',
    ['mcp', 'add', '-s', 'user', 'vision-bridge', '--', mcp.command, ...mcp.args],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  )
  if (claude.status === 0) log.push('MCP server -> claude mcp (user 作用域)')
  else log.push(`MCP 注册: 请手动执行 claude mcp add -s user vision-bridge -- ${mcp.command} ${mcp.args.join(' ')}`)

  if (writeIfAbsent(join(homedir(), '.claude', 'commands', 'vision.md'), VISION_COMMAND_MD)) {
    log.push('/vision 命令 -> ~/.claude/commands/vision.md')
  }
  return log
}

// ---------- Codex ----------

export function setupCodex(): string[] {
  const log: string[] = []
  const configPath = join(homedir(), '.codex', 'config.toml')
  const mcp = resolveCommand('mcp')
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  if (!existing.includes('[mcp_servers.vision-bridge]')) {
    mkdirSync(dirname(configPath), { recursive: true })
    const section = `\n[mcp_servers.vision-bridge]\ncommand = "${mcp.command}"\nargs = [${mcp.args.map((a) => `"${a}"`).join(', ')}]\n`
    writeFileSync(configPath, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + section)
    log.push(`MCP server -> ${configPath}`)
  }
  if (writeIfAbsent(join(homedir(), '.codex', 'prompts', 'vision.md'), VISION_COMMAND_MD)) {
    log.push('/vision 命令 -> ~/.codex/prompts/vision.md')
  }
  return log
}

// ---------- opencode ----------

export function setupOpencode(): string[] {
  const log: string[] = []
  const configPath = join(homedir(), '.config', 'opencode', 'opencode.json')
  const config = readJson(configPath)
  const mcp = resolveCommand('mcp')
  const mcpServers = (config.mcp ?? {}) as Record<string, unknown>
  if (!('vision-bridge' in mcpServers)) {
    mcpServers['vision-bridge'] = { type: 'local', command: [mcp.command, ...mcp.args], enabled: true }
    config.mcp = mcpServers
    writeJson(configPath, config)
    log.push(`MCP server -> ${configPath}`)
  }
  if (writeIfAbsent(join(homedir(), '.config', 'opencode', 'command', 'vision.md'), VISION_COMMAND_MD)) {
    log.push('/vision 命令 -> ~/.config/opencode/command/vision.md')
  }
  return log
}

export function detectTerminals(): TerminalId[] {
  const has = (bin: string): boolean =>
    process.platform === 'win32'
      ? spawnSync('where', [bin], { shell: true, stdio: 'ignore' }).status === 0
      : spawnSync('which', [bin], { stdio: 'ignore' }).status === 0
  const found: TerminalId[] = []
  if (has('claude')) found.push('claude-code')
  if (has('codex')) found.push('codex')
  if (has('opencode')) found.push('opencode')
  return found
}

export const TERMINAL_LABELS: Record<TerminalId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
}

export function applySetup(terminals: TerminalId[]): string[] {
  const results: string[] = []
  for (const t of terminals) {
    if (t === 'claude-code') results.push(...setupClaudeCode())
    else if (t === 'codex') results.push(...setupCodex())
    else if (t === 'opencode') results.push(...setupOpencode())
  }
  return results
}

export async function setupInteractive(): Promise<void> {
  p.intro('vision-bridge 终端接线')
  const detected = detectTerminals()
  if (!detected.length) {
    p.log.warn('未检测到 claude / codex / opencode，请确认已安装')
    p.outro('结束')
    return
  }
  const selected = await p.multiselect({
    message: '要配置到哪些终端？',
    options: detected.map((t) => ({ value: t, label: TERMINAL_LABELS[t] })),
    required: false,
  })
  if (p.isCancel(selected)) {
    p.cancel('已取消')
    return
  }
  if (!selected.length) {
    p.outro('未选择任何终端')
    return
  }
  const s = p.spinner()
  s.start('写入配置…')
  const log = applySetup(selected as TerminalId[])
  s.stop('完成')
  for (const line of log) p.log.success(line)
  p.outro('接线完成，重启对应终端后生效')
}

export async function setupAllDetected(): Promise<void> {
  const detected = detectTerminals()
  if (!detected.length) {
    console.log(pc.yellow('未检测到 claude / codex / opencode'))
    return
  }
  const log = applySetup(detected)
  for (const line of log) console.log(pc.green('  ✓ ') + line)
  console.log(`已配置: ${detected.map((t) => TERMINAL_LABELS[t]).join(', ')}，重启对应终端后生效`)
}
