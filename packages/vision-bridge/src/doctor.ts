import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pc from 'picocolors'
import { configPath, loadConfig, validateConfig } from './config.js'
import { detectTerminals, TERMINAL_LABELS, type TerminalId } from './setup.js'

function check(label: string, ok: boolean, detail?: string): void {
  const mark = ok ? pc.green('✓') : pc.yellow('!')
  console.log(`  ${mark} ${label}${detail ? pc.dim(` — ${detail}`) : ''}`)
}

function isWired(t: TerminalId): boolean {
  if (t === 'claude-code') {
    const settings = join(homedir(), '.claude', 'settings.json')
    if (!existsSync(settings)) return false
    return readFileSync(settings, 'utf8').includes('vision-bridge')
  }
  if (t === 'codex') {
    const toml = join(homedir(), '.codex', 'config.toml')
    if (!existsSync(toml)) return false
    return readFileSync(toml, 'utf8').includes('[mcp_servers.vision-bridge]')
  }
  const json = join(homedir(), '.config', 'opencode', 'opencode.json')
  if (!existsSync(json)) return false
  try {
    return 'vision-bridge' in ((JSON.parse(readFileSync(json, 'utf8')).mcp ?? {}) as object)
  } catch {
    return false
  }
}

export function doctor(): void {
  console.log(pc.bold('vision-bridge doctor\n'))

  console.log(pc.bold('配置'))
  try {
    const { config, exists } = loadConfig()
    check('配置文件', exists, exists ? configPath() : '未创建，运行 vision-bridge init')
    if (exists) {
      const errs = validateConfig(config)
      check('配置完整', errs.length === 0, errs.join('; ') || undefined)
    }
  } catch (e) {
    check('配置文件', false, (e as Error).message)
  }

  console.log(pc.bold('\n终端接线'))
  const detected = detectTerminals()
  if (!detected.length) console.log(pc.dim('  未检测到 claude / codex / opencode'))
  for (const t of detected) {
    check(TERMINAL_LABELS[t], isWired(t), isWired(t) ? '已接线' : '运行 vision-bridge setup')
  }
}
