import * as p from '@clack/prompts'
import { defaultConfig, saveConfig, validateConfig, type Config } from './config.js'
import { tinyPng } from './images.js'
import { describeImage } from './vision.js'
import { setupInteractive } from './setup.js'

export async function testConnection(config: Config): Promise<void> {
  const s = p.spinner()
  s.start('连接视觉模型…')
  try {
    const desc = await describeImage(config.vision, tinyPng(), '这张测试图是什么颜色？一句话回答。')
    s.stop('连接成功')
    p.log.success(`模型返回: ${desc.slice(0, 120)}`)
  } catch (e) {
    s.stop('连接失败')
    p.log.error((e as Error).message)
    throw e
  }
}

export async function initWizard(): Promise<void> {
  p.intro('vision-bridge 配置向导')
  const base = defaultConfig()

  const type = await p.select({
    message: '视觉模型协议',
    options: [
      { value: 'openai' as const, label: 'OpenAI 兼容', hint: 'GLM-4V / Qwen-VL / SiliconFlow / OpenRouter / Ollama…' },
      { value: 'anthropic' as const, label: 'Anthropic', hint: 'Claude 原生协议' },
    ],
  })
  if (p.isCancel(type)) return p.cancel('已取消')

  if (type === 'anthropic') {
    base.vision.type = 'anthropic'
    base.vision.baseUrl = 'https://api.anthropic.com'
    base.vision.model = 'claude-sonnet-5'
  }

  const baseUrl = await p.text({
    message: 'Base URL',
    placeholder: base.vision.baseUrl,
    defaultValue: base.vision.baseUrl,
  })
  if (p.isCancel(baseUrl)) return p.cancel('已取消')

  const model = await p.text({
    message: '模型名称',
    placeholder: base.vision.model,
    defaultValue: base.vision.model,
  })
  if (p.isCancel(model)) return p.cancel('已取消')

  const apiKey = await p.password({ message: 'API Key' })
  if (p.isCancel(apiKey)) return p.cancel('已取消')

  const maxTokens = await p.text({
    message: 'maxTokens（描述宁长勿缺）',
    placeholder: '4096',
    defaultValue: '4096',
  })
  if (p.isCancel(maxTokens)) return p.cancel('已取消')

  const config: Config = {
    vision: {
      ...base.vision,
      type,
      baseUrl: String(baseUrl),
      model: String(model),
      apiKey: String(apiKey),
      maxTokens: Number(maxTokens) || 4096,
    },
    hook: base.hook,
  }

  const errs = validateConfig(config)
  if (errs.length) {
    for (const e of errs) p.log.error(e)
    return p.outro('配置有误，未保存')
  }

  const doTest = await p.confirm({ message: '立即测试连接？', initialValue: true })
  if (p.isCancel(doTest)) return p.cancel('已取消')
  if (doTest) {
    try {
      await testConnection(config)
    } catch {
      const stillSave = await p.confirm({ message: '连接失败，仍然保存配置？' })
      if (p.isCancel(stillSave) || !stillSave) return p.outro('未保存')
    }
  }

  const path = saveConfig(config)
  p.log.success(`配置已保存: ${path}（权限 600）`)

  const doSetup = await p.confirm({ message: '现在自动接线到终端（Claude Code / Codex / opencode）？', initialValue: true })
  if (p.isCancel(doSetup)) return p.outro('已保存，之后可运行 vision-bridge setup')
  if (doSetup) await setupInteractive()
  else p.outro('之后可运行 vision-bridge setup 接线')
}
