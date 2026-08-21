import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
  claudeConfigDir,
  claudeSettingsPath,
  claudeUserMcpPath,
  codexHome,
  cursorConfigDir,
  isWindows,
  opencodeConfigDir,
  userHome,
} from './paths.js'

export type TerminalId = 'claude-code' | 'codex' | 'opencode' | 'cursor'

export interface ResolvedCommand {
  command: string
  args: string[]
}

function spawnOk(command: string, args: string[]): boolean {
  const r = spawnSync(command, args, {
    shell: isWindows(),
    stdio: 'ignore',
    windowsHide: true,
  })
  return r.status === 0
}

/** 解析可执行的 vision-relay 调用（Windows 用 .cmd / npx.cmd） */
export function resolveCommand(sub: string): ResolvedCommand {
  if (isWindows()) {
    if (spawnOk('vision-relay.cmd', ['--version']) || spawnOk('vision-relay', ['--version'])) {
      return { command: 'vision-relay', args: [sub] }
    }
    return { command: 'npx', args: ['-y', 'vision-relay', sub] }
  }
  if (spawnOk('vision-relay', ['--version'])) {
    return { command: 'vision-relay', args: [sub] }
  }
  return { command: 'npx', args: ['-y', 'vision-relay', sub] }
}

/**
 * Hook 用的整行命令（Claude/Codex settings 里是单字符串）。
 * Windows 必须经 cmd /c，否则 hook 找不到 npx/vision-relay。
 */
export function resolveHookCommandLine(): string {
  const r = resolveCommand('hook')
  if (isWindows()) {
    return `cmd /c ${r.command} ${r.args.join(' ')}`
  }
  return `${r.command} ${r.args.join(' ')}`
}

/** MCP stdio：command + args（写入 mcp.json / claude.json） */
export function resolveMcpStdio(): { command: string; args: string[] } {
  const r = resolveCommand('mcp')
  if (isWindows() && r.command === 'npx') {
    return { command: 'npx.cmd', args: r.args }
  }
  if (isWindows() && r.command === 'vision-relay') {
    return { command: 'vision-relay.cmd', args: r.args }
  }
  return r
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

/** Claude Code UserPromptSubmit：视觉识别常 >30s，必须显式拉高 timeout */
export const CLAUDE_HOOK_TIMEOUT_SEC = 120

/**
 * 确保 settings 里 vision-relay hook 存在且 timeout 足够。
 * 已存在但缺 timeout / 过短 / Windows 命令行过时 时就地修补。
 */
export function ensureClaudeVisionHook(settings: Record<string, unknown>): { changed: boolean; detail: string } {
  const command = resolveHookCommandLine()
  const hooksRoot = (settings.hooks ?? {}) as Record<string, unknown>
  const entries = Array.isArray(hooksRoot['UserPromptSubmit'])
    ? ([...hooksRoot['UserPromptSubmit']] as Array<Record<string, unknown>>)
    : []

  let changed = false
  let found = false
  for (const entry of entries) {
    const list = Array.isArray(entry.hooks) ? (entry.hooks as Array<Record<string, unknown>>) : []
    for (const h of list) {
      if (typeof h.command === 'string' && h.command.includes('vision-relay')) {
        found = true
        const t = typeof h.timeout === 'number' ? h.timeout : 0
        if (t < CLAUDE_HOOK_TIMEOUT_SEC) {
          h.timeout = CLAUDE_HOOK_TIMEOUT_SEC
          changed = true
        }
        if (h.command !== command) {
          h.command = command
          changed = true
        }
      }
    }
  }
  if (!found) {
    entries.push({
      hooks: [{ type: 'command', command, timeout: CLAUDE_HOOK_TIMEOUT_SEC }],
    })
    changed = true
  }
  if (changed) {
    hooksRoot['UserPromptSubmit'] = entries
    settings.hooks = hooksRoot
  }
  return {
    changed,
    detail: found
      ? `UserPromptSubmit hook timeout=${CLAUDE_HOOK_TIMEOUT_SEC}s`
      : `UserPromptSubmit hook 已安装（timeout=${CLAUDE_HOOK_TIMEOUT_SEC}s）`,
  }
}

/** 直接写入 ~/.claude.json（claude mcp add 在 Windows 上常失败） */
export function ensureClaudeUserMcp(): { changed: boolean; detail: string } {
  const mcpPath = claudeUserMcpPath()
  const mcp = resolveMcpStdio()
  const root = readJson(mcpPath)
  const servers = (root.mcpServers ?? {}) as Record<string, unknown>
  const next = {
    type: 'stdio',
    command: mcp.command,
    args: mcp.args,
  }
  const prev = servers['vision-relay']
  const same = JSON.stringify(prev) === JSON.stringify(next)
  if (same) return { changed: false, detail: `MCP 已存在 -> ${mcpPath}` }
  servers['vision-relay'] = next
  root.mcpServers = servers
  writeJson(mcpPath, root)
  return { changed: true, detail: `MCP server -> ${mcpPath}` }
}

// ---------- Claude Code ----------

export function setupClaudeCode(): string[] {
  const log: string[] = []
  const settingsPath = claudeSettingsPath()
  const settings = readJson(settingsPath)
  const hookFix = ensureClaudeVisionHook(settings)
  if (hookFix.changed) {
    writeJson(settingsPath, settings)
    log.push(`${hookFix.detail} -> ${settingsPath}`)
  }

  // 优先直接写 mcp 配置；再尝试 claude mcp add（失败可忽略）
  const mcpWrite = ensureClaudeUserMcp()
  if (mcpWrite.changed) log.push(mcpWrite.detail)
  else log.push(mcpWrite.detail)

  const mcp = resolveMcpStdio()
  const claude = spawnSync(
    'claude',
    ['mcp', 'add', '-s', 'user', 'vision-relay', '--', mcp.command, ...mcp.args],
    { encoding: 'utf8', shell: isWindows(), windowsHide: true },
  )
  if (claude.status === 0) log.push('MCP 亦已通过 claude mcp add 注册')

  const visionMd = loadBundledCommand('vision.md')
  const cmdPath = join(claudeConfigDir(), 'commands', 'vision.md')
  if (writeCommandFile(cmdPath, visionMd)) log.push(`/vision 命令已更新 -> ${cmdPath}`)

  for (const name of ['vision-config.md', 'vision-doctor.md'] as const) {
    const dest = join(claudeConfigDir(), 'commands', name)
    if (writeCommandFile(dest, loadBundledCommand(name))) {
      log.push(`/${name.replace(/\.md$/, '')} 已更新 -> ${dest}`)
    }
  }
  return log
}

// ---------- Codex ----------

export function setupCodex(): string[] {
  const log: string[] = []
  const configPath = join(codexHome(), 'config.toml')
  const mcp = resolveMcpStdio()
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  if (!existing.includes('[mcp_servers.vision-relay]')) {
    mkdirSync(dirname(configPath), { recursive: true })
    const section =
      `\n[mcp_servers.vision-relay]\n` +
      `type = "stdio"\n` +
      `command = "${mcp.command}"\n` +
      `args = [${mcp.args.map((a) => `"${a}"`).join(', ')}]\n`
    writeFileSync(configPath, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + section)
    log.push(`MCP server -> ${configPath}`)
  }

  const hooksPath = join(codexHome(), 'hooks.json')
  const hookLine = resolveHookCommandLine()
  const hooksJson = readJson(hooksPath)
  const hooks = (hooksJson.hooks ?? {}) as Record<string, unknown>
  const entries = Array.isArray(hooks['UserPromptSubmit']) ? [...(hooks['UserPromptSubmit'] as unknown[])] : []
  const already = JSON.stringify(entries).includes('vision-relay')
  if (!already) {
    hooks['UserPromptSubmit'] = [
      ...entries,
      {
        matcher: '',
        hooks: [{ type: 'command', command: hookLine, timeout: 120 }],
      },
    ]
    hooksJson.hooks = hooks
    writeJson(hooksPath, hooksJson)
    log.push(`UserPromptSubmit hook -> ${hooksPath}`)
  } else {
    let patched = false
    for (const entry of entries as Array<Record<string, unknown>>) {
      const list = Array.isArray(entry.hooks) ? (entry.hooks as Array<Record<string, unknown>>) : []
      for (const h of list) {
        if (typeof h.command === 'string' && h.command.includes('vision-relay')) {
          const t = typeof h.timeout === 'number' ? h.timeout : 0
          if (t < 120) {
            h.timeout = 120
            patched = true
          }
          if (h.command !== hookLine) {
            h.command = hookLine
            patched = true
          }
        }
      }
    }
    if (patched) {
      hooks['UserPromptSubmit'] = entries
      hooksJson.hooks = hooks
      writeJson(hooksPath, hooksJson)
      log.push(`Codex hook 已更新 -> ${hooksPath}`)
    }
  }

  const promptPath = join(codexHome(), 'prompts', 'vision.md')
  if (writeCommandFile(promptPath, loadBundledCommand('vision.md'))) {
    log.push(`/vision 命令已更新 -> ${promptPath}`)
  }
  return log
}

// ---------- opencode ----------

export function setupOpencode(): string[] {
  const log: string[] = []
  const configPath = join(opencodeConfigDir(), 'opencode.json')
  const config = readJson(configPath)
  const mcp = resolveMcpStdio()
  const mcpServers = (config.mcp ?? {}) as Record<string, unknown>
  if (!('vision-relay' in mcpServers)) {
    mcpServers['vision-relay'] = { type: 'local', command: [mcp.command, ...mcp.args], enabled: true }
    config.mcp = mcpServers
    writeJson(configPath, config)
    log.push(`MCP server -> ${configPath}`)
  }
  const cmdPath = join(opencodeConfigDir(), 'command', 'vision.md')
  if (writeCommandFile(cmdPath, loadBundledCommand('vision.md'))) {
    log.push(`/vision 命令已更新 -> ${cmdPath}`)
  }
  return log
}

// ---------- Cursor ----------

/** Cursor 无 UserPromptSubmit / 斜杠命令，主通道为 MCP */
export function setupCursor(): string[] {
  const log: string[] = []
  const configPath = join(cursorConfigDir(), 'mcp.json')
  const config = readJson(configPath)
  const mcp = resolveMcpStdio()
  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
  const next = { type: 'stdio', command: mcp.command, args: mcp.args }
  const prev = serversGet(mcpServers, 'vision-relay')
  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    mcpServers['vision-relay'] = next
    config.mcpServers = mcpServers
    writeJson(configPath, config)
    log.push(`MCP server -> ${configPath}`)
  }
  return log
}

function serversGet(servers: Record<string, unknown>, key: string): unknown {
  return servers[key]
}

export function detectTerminals(): TerminalId[] {
  const binExists = (bin: string): boolean => {
    if (isWindows()) {
      if (spawnOk('where', [bin])) return true
      if (spawnOk('where', [`${bin}.cmd`])) return true
      if (spawnSync('bash', ['-lc', `command -v ${bin} >/dev/null 2>&1`], { stdio: 'ignore' }).status === 0) {
        return true
      }
      return false
    }
    return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0
  }
  const hasDir = (...parts: string[]): boolean => existsSync(join(userHome(), ...parts))
  const found: TerminalId[] = []
  if (binExists('claude') || hasDir('.claude') || existsSync(claudeConfigDir())) found.push('claude-code')
  if (binExists('codex') || hasDir('.codex') || existsSync(codexHome())) found.push('codex')
  if (binExists('opencode') || existsSync(opencodeConfigDir())) found.push('opencode')
  if (binExists('cursor') || hasDir('.cursor')) found.push('cursor')
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

/** Windows / 非 TTY：多选不可靠，改为一键确认 */
function preferSimpleSetupUi(): boolean {
  return isWindows() || !process.stdin.isTTY || process.env.VISION_RELAY_SIMPLE_SETUP === '1'
}

export async function setupInteractive(): Promise<void> {
  p.intro('vision-relay 终端接线（命令 + MCP）')
  p.log.info(`用户目录: ${userHome()}`)
  let detected = detectTerminals()
  if (!detected.length) {
    p.log.warn('未检测到终端配置目录，将尝试写入常见路径（Claude / Codex / Cursor / opencode）')
    detected = ['claude-code', 'codex', 'cursor', 'opencode']
  }

  let terminals: TerminalId[]
  if (preferSimpleSetupUi()) {
    p.log.info(`将配置: ${detected.map((t) => TERMINAL_LABELS[t]).join(', ')}`)
    const ok = await p.confirm({
      message: '确认一键接线到上述终端？',
      initialValue: true,
    })
    if (p.isCancel(ok) || !ok) {
      p.outro('已取消。也可运行: vision-relay setup --all')
      return
    }
    terminals = detected
  } else {
    p.log.info(`已检测到: ${detected.map((t) => TERMINAL_LABELS[t]).join(', ')}`)
    p.log.info('多选：↑↓ 移动，空格勾选，回车确认（默认已全选）')
    const selected = await p.multiselect({
      message: '要配置到哪些终端？',
      options: detected.map((t) => ({ value: t, label: TERMINAL_LABELS[t] })),
      initialValues: [...detected],
      required: true,
    })
    if (p.isCancel(selected)) {
      p.cancel('已取消')
      return
    }
    terminals = (Array.isArray(selected) ? selected : []) as TerminalId[]
    if (!terminals.length) terminals = detected
  }

  const s = p.spinner()
  s.start('写入配置…')
  const log = applySetup(terminals)
  s.stop('完成')
  for (const line of log) p.log.success(line)
  p.outro('接线完成。看图: /vision <路径|clipboard> <问题>。请重启对应终端后生效')
}

export async function setupAllDetected(): Promise<void> {
  let detected = detectTerminals()
  if (!detected.length) {
    console.log(pc.yellow(`未检测到终端，仍写入常见路径（home=${userHome()}）`))
    detected = ['claude-code', 'codex', 'cursor', 'opencode']
  }
  const log = applySetup(detected)
  for (const line of log) console.log(pc.green('  ✓ ') + line)
  console.log(`已配置: ${detected.map((t) => TERMINAL_LABELS[t]).join(', ')}。看图: /vision <图> <问题>`)
}
