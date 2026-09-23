import * as p from '@clack/prompts'
import pc from 'picocolors'
import { defaultConfig, loadConfig, saveConfig, validateConfig, type Config } from './config.js'
import { tinyPng } from './images.js'
import { applyVisionPatch, formatVisionDiff, maskApiKey, recommendedModel, type VisionPatch } from './model-swap.js'
import { anthropicUrl, describeImage, openaiUrl } from './vision.js'
import { setupInteractive } from './setup.js'

export async function testConnection(config: Config): Promise<void> {
  const v = config.vision
  const endpoint = v.type === 'openai' ? openaiUrl(v.baseUrl) : anthropicUrl(v.baseUrl)
  const keyTail = maskApiKey(v.apiKey)
  const prompt = '这张测试图是什么颜色？一句话回答。'

  console.log(pc.bold('\n测试目标'))
  console.log(`  协议      ${v.type}`)
  console.log(`  端点      ${endpoint}`)
  console.log(`  模型      ${v.model}`)
  console.log(`  超时      ${v.timeoutMs ? `${(v.timeoutMs / 1000).toFixed(0)}s` : '无'}`)
  console.log(`  API Key   ${keyTail}`)

  console.log(pc.bold('\n发送内容'))
  console.log(`  图片      1x1 红色 PNG（67 字节，base64 内嵌）`)
  console.log(`  提问      ${prompt}`)

  console.log(pc.bold('\n预期'))
  console.log(`  HTTP 200 且响应非空；模型正常应提到"红"色`)

  const s = p.spinner()
  s.start('请求视觉模型…')
  const start = Date.now()
  try {
    const desc = await describeImage(v, tinyPng(), prompt)
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)
    s.stop(`连接成功（耗时 ${elapsed}s）`)
    p.log.success(`模型返回: ${desc.slice(0, 200)}`)
    const colorHit = /红|red/i.test(desc)
    p.log.success(`颜色判定: ${colorHit ? '响应包含"红"，符合预期' : '响应未提到"红"（模型描述风格差异，不影响链路判定）'}`)
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)
    s.stop(`连接失败（耗时 ${elapsed}s）`)
    p.log.error(`错误: ${(e as Error).message}`)
    p.log.info(`排查建议: 401/403 检查 API Key；404 检查 baseUrl 与模型名；超时增大 vision.timeoutMs；运行 vision-relay doctor 查看完整状态`)
    throw e
  }
}

/** 引导替换视觉模型：只换模型名 / 换供应商，每步回车可跳过保留现值 */
export async function swapModelWizard(): Promise<void> {
  const { config, exists } = loadConfig()
  p.intro('vision-relay 视觉模型替换')
  if (!exists) p.log.warn('未找到现有配置，将基于默认值开始')

  const v = config.vision
  console.log(pc.bold('\n当前视觉模型'))
  console.log(`  协议      ${v.type}`)
  console.log(`  Base URL  ${v.baseUrl}`)
  console.log(`  模型      ${v.model}`)
  console.log(`  API Key   ${maskApiKey(v.apiKey)}`)

  const mode = await p.select({
    message: '替换方式（每步回车可跳过保留现值）',
    options: [
      { value: 'model' as const, label: '只换模型名', hint: '保留协议/URL/密钥' },
      { value: 'provider' as const, label: '换供应商', hint: '协议/URL/密钥/模型整组更换' },
      { value: 'quit' as const, label: '退出', hint: '不做任何修改' },
    ],
  })
  if (p.isCancel(mode) || mode === 'quit') return p.cancel('已取消')

  const patch: VisionPatch = {}
  if (mode === 'model') {
    const model = await p.text({
      message: '模型名称（回车跳过）',
      placeholder: v.model,
      defaultValue: v.model,
    })
    if (p.isCancel(model)) return p.cancel('已取消')
    patch.model = String(model)
  } else {
    const type = await p.select({
      message: '协议类型',
      options: [
        { value: 'openai' as const, label: 'OpenAI' },
        { value: 'anthropic' as const, label: 'Anthropic' },
      ],
      initialValue: v.type,
    })
    if (p.isCancel(type)) return p.cancel('已取消')
    patch.type = type

    // 换协议时给出新协议的推荐值；协议未变则默认现值（回车即跳过）
    const suggestedUrl =
      type === v.type
        ? v.baseUrl
        : type === 'anthropic'
          ? 'https://api.anthropic.com'
          : 'https://api.openai.com/v1'
    const baseUrl = await p.text({
      message: 'Base URL（回车跳过）',
      placeholder: suggestedUrl,
      defaultValue: suggestedUrl,
    })
    if (p.isCancel(baseUrl)) return p.cancel('已取消')
    patch.baseUrl = String(baseUrl)

    const apiKey = await p.password({ message: 'API Key（回车跳过，保留现有）' })
    if (p.isCancel(apiKey)) return p.cancel('已取消')
    patch.apiKey = String(apiKey)

    const suggestedModel = type === v.type ? v.model : recommendedModel(type)
    const model = await p.text({
      message: '模型名称（回车跳过）',
      placeholder: suggestedModel,
      defaultValue: suggestedModel,
    })
    if (p.isCancel(model)) return p.cancel('已取消')
    patch.model = String(model)
  }

  const next = applyVisionPatch(config.vision, patch)
  const diff = formatVisionDiff(config.vision, next)
  if (diff.length === 0) return p.outro('无变更，未保存')

  console.log(pc.bold('\n变更预览'))
  for (const d of diff) console.log(`  ${d.field.padEnd(8)}${d.from} → ${d.to}`)

  const nextConfig: Config = { ...config, vision: next }
  const errs = validateConfig(nextConfig)
  if (errs.length) {
    for (const e of errs) p.log.error(e)
    return p.outro('配置有误，未保存')
  }

  const doSave = await p.confirm({ message: '保存这些变更？', initialValue: true })
  if (p.isCancel(doSave) || !doSave) return p.outro('未保存')

  const path = saveConfig(nextConfig)
  p.log.success(`配置已保存: ${path}（权限 600）`)

  const doTest = await p.confirm({ message: '立即测试连接？', initialValue: true })
  if (p.isCancel(doTest) || !doTest) return p.outro('完成')
  try {
    await testConnection(nextConfig)
  } catch {
    p.log.info('可稍后运行 vision-relay test 重试')
  }
  p.outro('完成')
}

export async function initWizard(): Promise<void> {
  p.intro('vision-relay 配置向导')
  const base = defaultConfig()

  const type = await p.select({
    message: '协议类型',
    options: [
      { value: 'openai' as const, label: 'OpenAI' },
      { value: 'anthropic' as const, label: 'Anthropic' },
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

  const config: Config = {
    vision: {
      ...base.vision,
      type,
      baseUrl: String(baseUrl),
      model: String(model),
      apiKey: String(apiKey),
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
  if (p.isCancel(doSetup)) return p.outro('已保存，之后可运行 vision-relay setup')
  if (doSetup) await setupInteractive()
  else p.outro('之后可运行 vision-relay setup 接线')
}
