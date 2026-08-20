import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, saveConfig } from '../src/config.js'
import { runClaudeCodeHook } from '../src/hook.js'
import { configPath } from '../src/config.js'
import { readImageRef } from '../src/images.js'

const describeImageMock = vi.hoisted(() => vi.fn(async () => '描述'))
vi.mock('../src/vision.js', () => ({ describeImage: describeImageMock }))

let cfgDir: string
let cwd: string

beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), 'vb-reg-'))
  cwd = mkdtempSync(join(tmpdir(), 'vb-reg-cwd-'))
  process.env.VISION_RELAY_CONFIG_DIR = cfgDir
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  saveConfig(cfg)
  describeImageMock.mockClear()
})

afterEach(() => {
  delete process.env.VISION_RELAY_CONFIG_DIR
})

describe('hook 健壮性（回归: 配置损坏不得崩溃 hook）', () => {
  it('config.json 损坏时返回 null 而非抛错', async () => {
    writeFileSync(configPath(), '{broken json')
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '看 a.png' }), cwd)
    expect(additionalContext).toBeNull()
  })

  it('config.json 为非法结构（数组）时返回 null', async () => {
    writeFileSync(configPath(), '[1,2,3]')
    const { additionalContext } = await runClaudeCodeHook('看 b.png', cwd)
    expect(additionalContext).toBeNull()
  })
})

describe('hook 多图并行（回归: 总耗时=最慢一张）', () => {
  it('多图全部识别且序号正确', async () => {
    writeFileSync(join(cwd, 'a.png'), 'x')
    writeFileSync(join(cwd, 'b.png'), 'x')
    writeFileSync(join(cwd, 'c.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook(
      JSON.stringify({ prompt: '对比 a.png b.png c.png' }),
      cwd,
    )
    expect(describeImageMock).toHaveBeenCalledTimes(3)
    expect(additionalContext).toContain('图片 #1: a.png')
    expect(additionalContext).toContain('图片 #2: b.png')
    expect(additionalContext).toContain('图片 #3: c.png')
  })

  it('并行时单图失败不影响其他图', async () => {
    writeFileSync(join(cwd, 'good.png'), 'x')
    writeFileSync(join(cwd, 'bad.png'), 'x')
    describeImageMock.mockImplementation(async () => {
      throw new Error('HTTP 500')
    })
    describeImageMock.mockImplementationOnce(async () => 'good 的描述')
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '看 good.png 和 bad.png' }), cwd)
    expect(additionalContext).toContain('good 的描述')
    expect(additionalContext).toContain('识别失败: HTTP 500')
  })
})

describe('图片大小上限（回归: 超大图不进内存）', () => {
  it('超过 maxBytes 拒绝读取', async () => {
    const bigFile = join(cwd, 'big.png')
    writeFileSync(bigFile, Buffer.alloc(1024)) // 1KB
    await expect(readImageRef({ kind: 'path', value: bigFile }, cwd, 512)).rejects.toThrow(/硬上限/)
  })

})
