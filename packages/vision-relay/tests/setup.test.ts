import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupCursor } from '../src/setup.js'

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
