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
  /** 图片硬上限（防 OOM），超过直接拒绝 */
  maxImageBytes: number
  /** 超过则自动压缩（降分辨率/转 JPEG）再送识别 */
  targetImageBytes: number
  /** 长边像素上限，超过自动等比缩小（长截图常见超限点） */
  maxImageEdge: number
}

export interface Config {
  vision: VisionConfig
  hook: { enabled: boolean; maxImages: number }
}

export const DEFAULT_PROMPT = `你是一个视觉转述引擎，为无法查看图片的编码助手描述图片。严格按以下结构输出：

1. 图片类型：UI 截图 / 报错或日志截图 / 设计稿 / 图表 / 照片 / 其他
2. 核心内容：一两句话概括这张图在说什么
3. 详细描述：
   - UI 截图：布局结构、可见文字全文转录、配色、控件状态、明显异常
   - 报错/日志截图：错误信息逐字全文转录（含错误码、文件名、行号）、堆栈关键帧
   - 图表：坐标轴、图例、数据点数值、趋势结论
   - 其他：关键对象、文字、颜色、空间位置
4. 编码助手需关注：与改代码/排查问题直接相关的细节

只输出以上内容，不要寒暄。`

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
      maxImageBytes: 100 * 1024 * 1024,
      targetImageBytes: 5 * 1024 * 1024,
      maxImageEdge: 8000,
    },
    hook: { enabled: true, maxImages: 4 },
  }
}

export function configDir(): string {
  if (process.env.VISION_RELAY_CONFIG_DIR) return process.env.VISION_RELAY_CONFIG_DIR
  const xdg = process.env.XDG_CONFIG_HOME
  return join(xdg || join(homedir(), '.config'), 'vision-relay')
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
  if (!Number.isInteger(v.maxImageBytes) || v.maxImageBytes <= 0) errs.push('vision.maxImageBytes 必须是正整数')
  if (!Number.isInteger(v.targetImageBytes) || v.targetImageBytes <= 0) errs.push('vision.targetImageBytes 必须是正整数')
  if (!Number.isInteger(v.maxImageEdge) || v.maxImageEdge <= 0) errs.push('vision.maxImageEdge 必须是正整数')
  return errs
}

export function saveConfig(c: Config): string {
  mkdirSync(configDir(), { recursive: true })
  const p = configPath()
  writeFileSync(p, JSON.stringify(c, null, 2))
  chmodSync(p, 0o600)
  return p
}
