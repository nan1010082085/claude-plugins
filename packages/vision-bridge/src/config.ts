import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface VisionConfig {
  type: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  prompt: string
  timeoutMs: number
}

export interface Config {
  vision: VisionConfig
  hook: { enabled: boolean; maxImages: number }
}

export const DEFAULT_PROMPT =
  '请详尽描述这张图片的内容。如果是 UI 截图，请描述布局、完整转录可见文字、颜色与明显异常；如果是图表，请提取关键数据；如果是报错/日志截图，请完整转录错误信息。只输出描述内容。'

export function defaultConfig(): Config {
  return {
    vision: {
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      maxTokens: 4096,
      prompt: DEFAULT_PROMPT,
      timeoutMs: 30000,
    },
    hook: { enabled: true, maxImages: 4 },
  }
}

export function configDir(): string {
  if (process.env.VISION_BRIDGE_CONFIG_DIR) return process.env.VISION_BRIDGE_CONFIG_DIR
  const xdg = process.env.XDG_CONFIG_HOME
  return join(xdg || join(homedir(), '.config'), 'vision-bridge')
}

export function configPath(): string {
  return join(configDir(), 'config.json')
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch as T) ?? base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v
  }
  return out as T
}

export function loadConfig(): { config: Config; exists: boolean } {
  const p = configPath()
  if (!existsSync(p)) return { config: defaultConfig(), exists: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    throw new Error(`配置文件解析失败 ${p}: ${(e as Error).message}`)
  }
  return { config: deepMerge(defaultConfig(), parsed), exists: true }
}

export function validateConfig(c: Config): string[] {
  const errs: string[] = []
  const v = c.vision
  if (v.type !== 'openai' && v.type !== 'anthropic') errs.push('vision.type 必须是 openai 或 anthropic')
  if (!v.baseUrl || !/^https?:\/\//.test(v.baseUrl)) errs.push('vision.baseUrl 必须是 http(s) 地址')
  if (!v.apiKey) errs.push('vision.apiKey 未配置')
  if (!v.model) errs.push('vision.model 未配置')
  if (!Number.isInteger(v.maxTokens) || v.maxTokens <= 0) errs.push('vision.maxTokens 必须是正整数')
  if (!Number.isInteger(v.timeoutMs) || v.timeoutMs <= 0) errs.push('vision.timeoutMs 必须是正整数')
  return errs
}

export function saveConfig(c: Config): string {
  mkdirSync(configDir(), { recursive: true })
  const p = configPath()
  writeFileSync(p, JSON.stringify(c, null, 2))
  chmodSync(p, 0o600)
  return p
}
