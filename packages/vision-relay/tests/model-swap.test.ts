import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config.js'
import {
  applyVisionPatch,
  formatVisionDiff,
  maskApiKey,
  recommendedModel,
} from '../src/model-swap.js'

const current = { ...defaultConfig().vision, apiKey: 'sk-abcdef0123456789' }

describe('recommendedModel', () => {
  it('anthropic 推荐 claude-sonnet-5', () => {
    expect(recommendedModel('anthropic')).toBe('claude-sonnet-5')
  })
  it('openai 推荐 gpt-4o-mini', () => {
    expect(recommendedModel('openai')).toBe('gpt-4o-mini')
  })
})

describe('applyVisionPatch', () => {
  it('只更新给出的字段，其余保持不变', () => {
    const next = applyVisionPatch(current, { model: 'gpt-4o' })
    expect(next.model).toBe('gpt-4o')
    expect(next.apiKey).toBe(current.apiKey)
    expect(next.type).toBe(current.type)
    expect(next.baseUrl).toBe(current.baseUrl)
    expect(next.maxTokens).toBe(current.maxTokens)
  })
  it('空串与空白串视为跳过，保留现值', () => {
    const next = applyVisionPatch(current, { model: '  ', baseUrl: '', apiKey: '' })
    expect(next).toEqual(current)
  })
  it('undefined 字段视为跳过', () => {
    expect(applyVisionPatch(current, {})).toEqual(current)
  })
  it('不修改传入的 current 对象', () => {
    const snapshot = { ...current }
    applyVisionPatch(current, { model: 'gpt-4o', type: 'anthropic' })
    expect(current).toEqual(snapshot)
  })
  it('换供应商时可同时更新四个字段', () => {
    const next = applyVisionPatch(current, {
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-new',
      model: 'claude-sonnet-5',
    })
    expect(next.type).toBe('anthropic')
    expect(next.baseUrl).toBe('https://api.anthropic.com')
    expect(next.apiKey).toBe('sk-ant-new')
    expect(next.model).toBe('claude-sonnet-5')
  })
})

describe('maskApiKey', () => {
  it('空值显示 未配置', () => {
    expect(maskApiKey('')).toBe('未配置')
  })
  it('保留前 3 后 4 中间打码', () => {
    expect(maskApiKey('sk-abcdef0123456789')).toBe('sk-***6789')
  })
  it('过短的整体打码', () => {
    expect(maskApiKey('short')).toBe('*****')
  })
})

describe('formatVisionDiff', () => {
  it('无变更返回空数组', () => {
    expect(formatVisionDiff(current, { ...current })).toEqual([])
  })
  it('只列出变更字段，apiKey 打码', () => {
    const after = { ...current, model: 'gpt-4o', apiKey: 'sk-XYZXYZ9999' }
    const diff = formatVisionDiff(current, after)
    expect(diff).toEqual([
      { field: 'apiKey', from: 'sk-***6789', to: 'sk-***9999' },
      { field: 'model', from: current.model, to: 'gpt-4o' },
    ])
  })
  it('maxTokens 等非模型字段不进 diff', () => {
    const after = { ...current, maxTokens: 8192 }
    expect(formatVisionDiff(current, after)).toEqual([])
  })
})
