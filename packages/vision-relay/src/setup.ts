import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'
import pc from 'picocolors'

export type TerminalId = 'claude-code' | 'codex' | 'opencode' | 'cursor'

export interface ResolvedCommand {
  command: string
  args: string[]
}

/** 优先全局 vision-relay，不可用则回退 npx */
export function resolveCommand(sub: string): ResolvedCommand {
  const ok = spawnSync('vision-relay', ['--version'], { shell: process.platform === 'win32' })
  if (ok.status === 0) return { command: 'vision-relay', args: [sub] }
  return { command: 'npx', args: ['-y', 'vision-relay', sub] }
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

/** 包根目录（src 或 dist 的上一级） */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

/** 读取 packages 内 commands/*.md，setup 时同步到各终端 */
export function loadBundledCommand(name: string): string {
  const p = join(packageRoot(), 'commands', name)
  if (!existsSync(p)) throw new Error(`缺少内置命令模板: ${p}`)
  return readFileSync(p, 'utf8')
}

/**
 * 写入斜杠命令模板（始终覆盖，保证 /vision 两段式规则可随版本更新）。
 * @returns 是否发生了内容变化
 */
export function writeCommandFile(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  writeFileSync(path, content)
  return true
}

// ---------- Claude Code ----------

export function setupClaudeCode(): string[] {
  const log: string[] = []
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  const settings = readJson(settingsPath)
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  const hookCmd = resolveCommand('hook')
  const entries = Array.isArray(hooks['UserPromptSubmit']) ? hooks['UserPromptSubmit'] : []
  const already = JSON.stringify(entries).includes('vision-relay')
  if (!already) {
    hooks['UserPromptSubmit'] = [
      ...entries,
      { hooks: [{ type: 'command', command: `${hookCmd.command} ${hookCmd.args.join(' ')}`, timeout: 60 }] },
    ]
    settings.hooks = hooks
    writeJson(settingsPath, settings)
    log.push(`UserPromptSubmit hook -> ${settingsPath}`)
  }

  const mcp = resolveCommand('mcp')
  const claude = spawnSync(
    'claude',
    ['mcp', 'add', '-s', 'user', 'vision-relay', '--', mcp.command, ...mcp.args],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  )
  if (claude.status === 0) log.push('MCP server -> claude mcp (user 作用域)')
  else log.push(`MCP 注册: 请手动执行 claude mcp add -s user vision-relay -- ${mcp.command} ${mcp.args.join(' ')}`)

  const visionMd = loadBundledCommand('vision.md')
  const cmdPath = join(homedir(), '.claude', 'commands', 'vision.md')
  if (writeCommandFile(cmdPath, visionMd)) log.push(`/vision 命令已更新 -> ${cmdPath}`)

  for (const name of ['vision-config.md', 'vision-doctor.md'] as const) {
    const dest = join(homedir(), '.claude', 'commands', name)
    if (writeCommandFile(dest, loadBundledCommand(name))) log.push(`/${name.replace(/\.md$/, '')} 已更新 -> ${dest}`)
  }
  return log
}

// ---------- Codex ----------

export function setupCodex(): string[] {
  const log: string[] = []
  const configPath = join(homedir(), '.codex', 'config.toml')
  const mcp = resolveCommand('mcp')
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  if (!existing.includes('[mcp_servers.vision-relay]')) {
    mkdirSync(dirname(configPath), { recursive: true })
    const section = `\n[mcp_servers.vision-relay]\ntype = "stdio"\ncommand = "${mcp.command}"\nargs = [${mcp.args.map((a) => `"${a}"`).join(', ')}]\n`
    writeFileSync(configPath, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + section)
    log.push(`MCP server -> ${configPath}`)
  }

  const hooksPath = join(homedir(), '.codex', 'hooks.json')
  const hookCmd = resolveCommand('hook')
  const hooksJson = readJson(hooksPath)
  const hooks = (hooksJson.hooks ?? {}) as Record<string, unknown>
  const entries = Array.isArray(hooks['UserPromptSubmit']) ? hooks['UserPromptSubmit'] : []
  const already = JSON.stringify(entries).includes('vision-relay')
  if (!already) {
    hooks['UserPromptSubmit'] = [
      ...entries,
      { matcher: '', hooks: [{ type: 'command', command: `${hookCmd.command} ${hookCmd.args.join(' ')}`, timeout: 60 }] },
    ]
    hooksJson.hooks = hooks
    writeJson(hooksPath, hooksJson)
    log.push(`UserPromptSubmit hook -> ${hooksPath}`)
  }

  const promptPath = join(homedir(), '.codex', 'prompts', 'vision.md')
  if (writeCommandFile(promptPath, loadBundledCommand('vision.md'))) {
    log.push(`/vision 命令已更新 -> ${promptPath}`)
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
  if (!('vision-relay' in mcpServers)) {
    mcpServers['vision-relay'] = { type: 'local', command: [mcp.command, ...mcp.args], enabled: true }
    config.mcp = mcpServers
    writeJson(configPath, config)
    log.push(`MCP server -> ${configPath}`)
  }
  const cmdPath = join(homedir(), '.config', 'opencode', 'command', 'vision.md')
  if (writeCommandFile(cmdPath, loadBundledCommand('vision.md'))) {
    log.push(`/vision 命令已更新 -> ${cmdPath}`)
  }
  return log
}

// ---------- Cursor ----------

/** Cursor 无 UserPromptSubmit / 斜杠命令，主通道为 MCP */
export function setupCursor(): string[] {
  const log: string[] = []
  const configPath = join(homedir(), '.cursor', 'mcp.json')
  const config = readJson(configPath)
  const mcp = resolveCommand('mcp')
  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
  if (!('vision-relay' in mcpServers)) {
    mcpServers['vision-relay'] = { type: 'stdio', command: mcp.command, args: mcp.args }
    config.mcpServers = mcpServers
    writeJson(configPath, config)
    log.push(`MCP server -> ${configPath}`)
  }
  return log
}

export function detectTerminals(): TerminalId[] {
  const has = (bin: string): boolean =>
    process.platform === 'win32'
      ? spawnSync('where', [bin], { shell: true, stdio: 'ignore' }).status === 0
      : spawnSync('which', [bin], { stdio: 'ignore' }).status === 0
  const hasDir = (dir: string): boolean => existsSync(join(homedir(), dir))
  const found: TerminalId[] = []
  if (has('claude') || hasDir('.claude')) found.push('claude-code')
  if (has('codex') || hasDir('.codex')) found.push('codex')
  if (has('opencode') || hasDir(join('.config', 'opencode'))) found.push('opencode')
  if (has('cursor') || hasDir('.cursor')) found.push('cursor')
  return found
}

export const TERMINAL_LABELS: Record<TerminalId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  cursor: 'Cursor',
}

export function applySetup(terminals: TerminalId[]): string[] {
  const results: string[] = []
  for (const t of terminals) {
    if (t === 'claude-code') results.push(...setupClaudeCode())
    else if (t === 'codex') results.push(...setupCodex())
    else if (t === 'opencode') results.push(...setupOpencode())
    else if (t === 'cursor') results.push(...setupCursor())
  }
  return results
}

export async function setupInteractive(): Promise<void> {
  p.intro('vision-relay 终端接线（命令 + MCP）')
  const detected = detectTerminals()
  if (!detected.length) {
    p.log.warn('未检测到 claude / codex / opencode / cursor，请确认已安装')
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
  p.outro('接线完成。看图请用 /vision <路径> <问题>（先识别再回答）。重启对应终端后生效')
}

export async function setupAllDetected(): Promise<void> {
  const detected = detectTerminals()
  if (!detected.length) {
    console.log(pc.yellow('未检测到 claude / codex / opencode / cursor'))
    return
  }
  const log = applySetup(detected)
  for (const line of log) console.log(pc.green('  ✓ ') + line)
  console.log(`已配置: ${detected.map((t) => TERMINAL_LABELS[t]).join(', ')}。看图: /vision <图> <问题>`)
}
