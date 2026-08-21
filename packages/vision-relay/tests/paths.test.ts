import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { userHome } from '../src/paths.js'
import { ensureClaudeUserMcp, resolveHookCommandLine } from '../src/setup.js'

const prevHome = process.env.HOME
const prevProfile = process.env.USERPROFILE
const prevVrHome = process.env.VISION_RELAY_HOME

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = prevProfile
  if (prevVrHome === undefined) delete process.env.VISION_RELAY_HOME
  else process.env.VISION_RELAY_HOME = prevVrHome
})

describe('paths / Windows wiring helpers', () => {
  it('VISION_RELAY_HOME 优先', () => {
    const h = mkdtempSync(join(tmpdir(), 'vr-home-'))
    process.env.VISION_RELAY_HOME = h
    expect(userHome()).toBe(h)
  })

  it('ensureClaudeUserMcp 写入 claude.json', () => {
    const h = mkdtempSync(join(tmpdir(), 'vr-mcp-'))
    process.env.VISION_RELAY_HOME = h
    process.env.HOME = h
    mkdirSync(h, { recursive: true })
    const r = ensureClaudeUserMcp()
    expect(r.changed).toBe(true)
    const again = ensureClaudeUserMcp()
    expect(again.changed).toBe(false)
  })

  it('resolveHookCommandLine 含 vision-relay', () => {
    expect(resolveHookCommandLine()).toContain('vision-relay')
  })
})
