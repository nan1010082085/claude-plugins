import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 跨平台用户主目录（macOS / Windows / Git Bash）。
 * Windows 优先 USERPROFILE，避免 Git Bash 的 HOME=/d/... 与 Node/Claude 实际目录不一致。
 */
export function userHome(): string {
  if (process.env.VISION_RELAY_HOME) return process.env.VISION_RELAY_HOME
  if (process.platform === 'win32') {
    const up = process.env.USERPROFILE?.trim()
    if (up && existsSync(up)) return up
  }
  const envHome = process.env.HOME?.trim()
  if (envHome && existsSync(envHome)) return envHome
  return homedir()
}

/** `~/.claude`（可用 CLAUDE_CONFIG_DIR 覆盖） */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(userHome(), '.claude')
}

export function claudeSettingsPath(): string {
  return join(claudeConfigDir(), 'settings.json')
}

/** Claude 用户级 MCP：`~/.claude.json` */
export function claudeUserMcpPath(): string {
  return join(userHome(), '.claude.json')
}

export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(userHome(), '.codex')
}

export function cursorConfigDir(): string {
  return join(userHome(), '.cursor')
}

export function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  if (xdg) return join(xdg, 'opencode')
  return join(userHome(), '.config', 'opencode')
}

export function isWindows(): boolean {
  return process.platform === 'win32'
}
