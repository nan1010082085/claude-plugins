import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type Config } from '../src/config.js'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn() },
  saveConfig: vi.fn(() => '/tmp/config.json'),
  loadConfig: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  ...mocks,
  isCancel: (v: unknown) => v === '__cancel__',
}))
vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>()
  return { ...actual, saveConfig: mocks.saveConfig, loadConfig: mocks.loadConfig }
})

import { swapModelWizard } from '../src/tui.js'

const current: Config = {
  ...defaultConfig(),
  vision: { ...defaultConfig().vision, apiKey: 'sk-OLDOLD123456', model: 'gpt-4o-mini' },
}

beforeEach(() => {
  for (const m of [mocks.select, mocks.text, mocks.password, mocks.confirm]) m.mockReset()
  mocks.saveConfig.mockClear()
  mocks.loadConfig.mockReset()
  mocks.loadConfig.mockReturnValue({ config: structuredClone(current), exists: true })
})

describe('swapModelWizard', () => {
  it('只换模型名：其余字段保持不变并保存', async () => {
    mocks.select.mockResolvedValueOnce('model') // 替换方式
    mocks.text.mockResolvedValueOnce('gpt-4o') // 模型名称
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false) // 保存？测试？

    await swapModelWizard()

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1)
    const saved = mocks.saveConfig.mock.calls[0][0] as Config
    expect(saved.vision.model).toBe('gpt-4o')
    expect(saved.vision.apiKey).toBe(current.vision.apiKey)
    expect(saved.vision.type).toBe(current.vision.type)
    expect(saved.vision.baseUrl).toBe(current.vision.baseUrl)
  })

  it('输入空白视为跳过：无变更时不保存', async () => {
    mocks.select.mockResolvedValueOnce('model')
    mocks.text.mockResolvedValueOnce('   ')

    await swapModelWizard()

    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })

  it('换供应商：整组更新协议/URL/密钥/模型并保存', async () => {
    mocks.select
      .mockResolvedValueOnce('provider') // 替换方式
      .mockResolvedValueOnce('anthropic') // 协议类型
    mocks.text
      .mockResolvedValueOnce('https://api.anthropic.com') // Base URL
      .mockResolvedValueOnce('claude-sonnet-5') // 模型名称
    mocks.password.mockResolvedValueOnce('sk-ANTNEW987654')
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false) // 保存？测试？

    await swapModelWizard()

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1)
    const saved = mocks.saveConfig.mock.calls[0][0] as Config
    expect(saved.vision.type).toBe('anthropic')
    expect(saved.vision.baseUrl).toBe('https://api.anthropic.com')
    expect(saved.vision.apiKey).toBe('sk-ANTNEW987654')
    expect(saved.vision.model).toBe('claude-sonnet-5')
  })

  it('换供应商时密钥回车跳过：保留现有密钥', async () => {
    mocks.select.mockResolvedValueOnce('provider').mockResolvedValueOnce('openai')
    mocks.text.mockResolvedValueOnce('').mockResolvedValueOnce('gpt-4o')
    mocks.password.mockResolvedValueOnce('') // 跳过密钥
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await swapModelWizard()

    const saved = mocks.saveConfig.mock.calls[0][0] as Config
    expect(saved.vision.apiKey).toBe(current.vision.apiKey)
    expect(saved.vision.model).toBe('gpt-4o')
  })

  it('变更预览后拒绝保存：不写入', async () => {
    mocks.select.mockResolvedValueOnce('model')
    mocks.text.mockResolvedValueOnce('gpt-4o')
    mocks.confirm.mockResolvedValueOnce(false) // 不保存

    await swapModelWizard()

    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })

  it('首步退出：不询问不保存', async () => {
    mocks.select.mockResolvedValueOnce('quit')

    await swapModelWizard()

    expect(mocks.saveConfig).not.toHaveBeenCalled()
    expect(mocks.text).not.toHaveBeenCalled()
  })
})
