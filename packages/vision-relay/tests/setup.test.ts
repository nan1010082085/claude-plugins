import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureClaudeVisionHook,
  loadBundledCommand,
  setupClaudeCode,
  setupCursor,
  writeCommandFile,
} from '../src/setup.js'

let home: string
let realHome: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vb-setup-'))
  realHome = process.env.HOME!
  process.env.HOME = home
})

afterEach(() => {
  process.env.HOME = realHome
})

function mcpJsonPath(): string {
  return join(home, '.cursor', 'mcp.json')
}

describe('ensureClaudeVisionHook', () => {
  it('补上缺失的 timeout', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'vision-relay hook' }] }],
      },
    }
    const r = ensureClaudeVisionHook(settings)
    expect(r.changed).toBe(true)
    const h = (settings.hooks as { UserPromptSubmit: Array<{ hooks: Array<{ timeout: number }> }> }).UserPromptSubmit[0]
      .hooks[0]
    expect(h.timeout).toBe(120)
  })

  it('过短 timeout 抬到 120', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'vision-relay hook', timeout: 30 }] }],
      },
    }
    expect(ensureClaudeVisionHook(settings).changed).toBe(true)
    const h = (settings.hooks as { UserPromptSubmit: Array<{ hooks: Array<{ timeout: number }> }> }).UserPromptSubmit[0]
      .hooks[0]
    expect(h.timeout).toBe(120)
  })
})

describe('writeCommandFile / 命令模板', () => {
  it('覆盖更新旧版 /vision 模板', () => {
    const path = join(home, '.claude', 'commands', 'vision.md')
    mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
    writeFileSync(path, 'old template')
    expect(writeCommandFile(path, loadBundledCommand('vision.md'))).toBe(true)
    const body = readFileSync(path, 'utf8')
    expect(body).toContain('第 1 段：视觉识别')
    expect(body).toContain('vision-relay describe')
    expect(writeCommandFile(path, loadBundledCommand('vision.md'))).toBe(false)
  })
})

describe('setupClaudeCode 命令同步', () => {
  it('写入并更新 vision.md', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), '{}')
    setupClaudeCode()
    const path = join(home, '.claude', 'commands', 'vision.md')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('vision-relay describe')
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    expect(JSON.stringify(settings)).toContain('timeout')
  })
})

describe('setupCursor', () => {
  it('mcp.json 不存在时创建并写入 vision-relay', () => {
    const log = setupCursor()
    expect(existsSync(mcpJsonPath())).toBe(true)
    const config = JSON.parse(readFileSync(mcpJsonPath(), 'utf8'))
    expect(config.mcpServers['vision-relay']).toMatchObject({ type: 'stdio' })
    expect(log.some((l) => l.includes('mcp.json'))).toBe(true)
  })

  it('保留已有 MCP server，只追加 vision-relay', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true })
    writeFileSync(mcpJsonPath(), JSON.stringify({ mcpServers: { seekstone: { type: 'stdio', command: 'npx' } } }))
    setupCursor()
    const config = JSON.parse(readFileSync(mcpJsonPath(), 'utf8'))
    expect(config.mcpServers.seekstone).toEqual({ type: 'stdio', command: 'npx' })
    expect(config.mcpServers['vision-relay']).toBeDefined()
  })

  it('已配置过时幂等，不重复写入', () => {
    setupCursor()
    const log = setupCursor()
    expect(log).toEqual([])
    const config = JSON.parse(readFileSync(mcpJsonPath(), 'utf8'))
    expect(Object.keys(config.mcpServers).filter((k) => k === 'vision-relay')).toHaveLength(1)
  })

  it('损坏的 mcp.json 不阻断（按空配置重建）', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true })
    writeFileSync(mcpJsonPath(), '{broken json')
    const log = setupCursor()
    expect(log.length).toBeGreaterThan(0)
    const config = JSON.parse(readFileSync(mcpJsonPath(), 'utf8'))
    expect(config.mcpServers['vision-relay']).toBeDefined()
  })
})
