import { describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig, saveConfig, validateConfig } from '../src/config.js'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = { ...defaultConfig(), vision: { ...defaultConfig().vision, apiKey: 'sk-test' } }

describe('validateConfig', () => {
  it('完整配置通过', () => {
    expect(validateConfig(base)).toEqual([])
  })
  it('缺失项逐条报错', () => {
    const errs = validateConfig({ ...base, vision: { ...base.vision, apiKey: '', model: '' } })
    expect(errs).toContain('vision.apiKey 未配置')
    expect(errs).toContain('vision.model 未配置')
  })
  it('非法 type 报错', () => {
    const errs = validateConfig({ ...base, vision: { ...base.vision, type: 'ollama' as 'openai' } })
    expect(errs[0]).toMatch('vision.type')
  })
})

describe('load/save', () => {
  it('保存后加载往返一致且权限 600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vb-cfg-'))
    process.env.VISION_BRIDGE_CONFIG_DIR = dir
    try {
      saveConfig(base)
      expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600)
      const { config, exists } = loadConfig()
      expect(exists).toBe(true)
      expect(config).toEqual(base)
    } finally {
      delete process.env.VISION_BRIDGE_CONFIG_DIR
    }
  })
  it('不存在时返回默认值', () => {
    process.env.VISION_BRIDGE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'vb-cfg-'))
    try {
      const { config, exists } = loadConfig()
      expect(exists).toBe(false)
      expect(config).toEqual(defaultConfig())
    } finally {
      delete process.env.VISION_BRIDGE_CONFIG_DIR
    }
  })
})
