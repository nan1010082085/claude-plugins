import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const describeImageMock = vi.hoisted(() => vi.fn(async () => '描述：红色按钮'))
vi.mock('../src/vision.js', () => ({
  describeImage: describeImageMock,
  openaiUrl: (u: string) => u,
  anthropicUrl: (u: string) => u,
}))

const { describeCli } = await import('../src/describe-cli.js')
const { defaultConfig, saveConfig } = await import('../src/config.js')

let cfgDir: string
let cwd: string
let realCwd: string

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), 'vb-desc-'))
  process.env.VISION_RELAY_CONFIG_DIR = cfgDir
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  saveConfig(cfg)
  cwd = mkdtempSync(join(tmpdir(), 'vb-desc-cwd-'))
  realCwd = process.cwd()
  process.chdir(cwd)
  writeFileSync(join(cwd, 'a.png'), PNG)
  describeImageMock.mockClear()
})

afterEach(() => {
  process.chdir(realCwd)
  delete process.env.VISION_RELAY_CONFIG_DIR
})

describe('describeCli', () => {
  it('识别本地图并写 stdout', async () => {
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((c: string | Uint8Array) => {
      chunks.push(String(c))
      return true
    }) as typeof process.stdout.write
    try {
      const code = await describeCli({ image: 'a.png', question: '按钮什么颜色' })
      expect(code).toBe(0)
      expect(chunks.join('')).toContain('红色按钮')
      expect(chunks.join('')).toContain('✓ 已识别')
      expect(describeImageMock).toHaveBeenCalled()
      expect(describeImageMock.mock.calls[0][2]).toBe('按钮什么颜色')
    } finally {
      process.stdout.write = orig
    }
  })

  it('缺图返回 1', async () => {
    expect(await describeCli({ image: '' })).toBe(1)
  })
})
