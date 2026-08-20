import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, saveConfig } from '../src/config.js'
import { runClaudeCodeHook } from '../src/hook.js'

const describeImageMock = vi.hoisted(() => vi.fn(async () => '一张报错截图：TypeError: x is not a function'))
vi.mock('../src/vision.js', () => ({ describeImage: describeImageMock }))

let cfgDir: string
let cwd: string

beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), 'vb-hook-'))
  cwd = mkdtempSync(join(tmpdir(), 'vb-hook-cwd-'))
  process.env.VISION_BRIDGE_CONFIG_DIR = cfgDir
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  saveConfig(cfg)
  describeImageMock.mockClear()
})

function withKey(mod: Partial<ReturnType<typeof defaultConfig>>): ReturnType<typeof defaultConfig> {
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  return Object.assign(cfg, mod)
}

afterEach(() => {
  delete process.env.VISION_BRIDGE_CONFIG_DIR
})

describe('runClaudeCodeHook', () => {
  it('prompt 含真实图片路径时注入描述', async () => {
    writeFileSync(join(cwd, 'shot.png'), 'x')
    const input = JSON.stringify({ prompt: '帮我看看 shot.png 这个报错', cwd })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('[vision-bridge 图片 #1: shot.png]')
    expect(additionalContext).toContain('TypeError: x is not a function')
    expect(describeImageMock).toHaveBeenCalledTimes(1)
  })

  it('无图片时返回 null 且不调用模型', async () => {
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '普通问题' }), cwd)
    expect(additionalContext).toBeNull()
    expect(describeImageMock).not.toHaveBeenCalled()
  })

  it('单图失败不阻塞，注入失败说明', async () => {
    writeFileSync(join(cwd, 'bad.png'), 'x')
    describeImageMock.mockRejectedValueOnce(new Error('HTTP 500'))
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '看 bad.png' }), cwd)
    expect(additionalContext).toContain('识别失败: HTTP 500')
  })

  it('hook 禁用时直接跳过', async () => {
    saveConfig(withKey({ hook: { enabled: false, maxImages: 4 } }))
    writeFileSync(join(cwd, 'a.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '看 a.png' }), cwd)
    expect(additionalContext).toBeNull()
  })

  it('超过 maxImages 截断', async () => {
    saveConfig(withKey({ hook: { enabled: true, maxImages: 1 } }))
    writeFileSync(join(cwd, 'a.png'), 'x')
    writeFileSync(join(cwd, 'b.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '对比 a.png 和 b.png' }), cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(1)
    expect(additionalContext).toContain('a.png')
  })

  it('非 JSON 输入按纯文本处理', async () => {
    writeFileSync(join(cwd, 'c.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook('看看 c.png', cwd)
    expect(additionalContext).toContain('c.png')
  })
})
