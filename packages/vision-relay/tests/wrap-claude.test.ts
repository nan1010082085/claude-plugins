import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildClaudeArgv,
  isLoopbackBaseUrl,
  resolveClaudeUpstream,
  sessionSettingsPath,
  writeSessionSettingsFile,
} from '../src/wrap-claude.js'

const prevHome = process.env.HOME
const prevConfig = process.env.VISION_RELAY_CONFIG_DIR

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevConfig === undefined) delete process.env.VISION_RELAY_CONFIG_DIR
  else process.env.VISION_RELAY_CONFIG_DIR = prevConfig
})

describe('resolveClaudeUpstream', () => {
  it('isLoopbackBaseUrl', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:8347')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::1]:8347')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::ffff:127.0.0.1]:8347')).toBe(true)
    expect(isLoopbackBaseUrl('https://ark.cn-beijing.volces.com/api/coding')).toBe(false)
  })

  it('优先非本机环境变量', () => {
    const r = resolveClaudeUpstream({
      ANTHROPIC_BASE_URL: 'https://example.com/coding/',
    })
    expect(r.upstream).toBe('https://example.com/coding')
    expect(r.source).toBe('env')
  })

  it('环境为本机时回退 settings', () => {
    const home = join(tmpdir(), `vr-wrap-${Date.now()}`)
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://ark.example/api/coding' },
      }),
    )
    process.env.HOME = home
    const r = resolveClaudeUpstream({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8347' })
    expect(r.upstream).toBe('https://ark.example/api/coding')
    expect(r.source).toBe('settings')
  })

  it('settings 也是本机则抛错', () => {
    const home = join(tmpdir(), `vr-wrap-bad-${Date.now()}`)
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } }),
    )
    process.env.HOME = home
    expect(() => resolveClaudeUpstream({})).toThrow(/本机/)
  })

  it('writeSessionSettingsFile 写入固定路径，buildClaudeArgv 使用 --settings', () => {
    const file = writeSessionSettingsFile('http://127.0.0.1:9999')
    expect(file).toBe(sessionSettingsPath())
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999' },
    })
    const argv = buildClaudeArgv(file, ['-c'])
    expect(argv).toEqual(['--settings', file, '-c'])
  })
})
