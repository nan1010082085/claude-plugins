import type { VisionConfig } from './config.js'

export type VisionPatch = Partial<Pick<VisionConfig, 'type' | 'baseUrl' | 'apiKey' | 'model'>>

/** 换协议时的推荐模型名 */
export function recommendedModel(type: VisionConfig['type']): string {
  return type === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini'
}

/**
 * 应用视觉模型补丁：空白串 / undefined 视为跳过保留现值。
 * 不修改传入对象，返回新的 VisionConfig。
 */
export function applyVisionPatch(current: VisionConfig, patch: VisionPatch): VisionConfig {
  const next: VisionConfig = { ...current }
  for (const key of ['type', 'baseUrl', 'apiKey', 'model'] as const) {
    const v = patch[key]
    if (typeof v === 'string' && v.trim() !== '') next[key] = v.trim() as never
  }
  return next
}

/** API Key 打码：前 3 后 4；过短整体打码；空值显示"未配置" */
export function maskApiKey(key: string): string {
  if (!key) return '未配置'
  if (key.length < 8) return '*'.repeat(key.length)
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

const DIFF_FIELDS = ['type', 'baseUrl', 'apiKey', 'model'] as const

export interface DiffEntry {
  field: (typeof DIFF_FIELDS)[number]
  from: string
  to: string
}

/** 视觉模型四项（协议/URL/密钥/模型）的变更清单；apiKey 打码后展示 */
export function formatVisionDiff(before: VisionConfig, after: VisionConfig): DiffEntry[] {
  const out: DiffEntry[] = []
  for (const field of DIFF_FIELDS) {
    if (before[field] === after[field]) continue
    const from = field === 'apiKey' ? maskApiKey(before[field]) : before[field]
    const to = field === 'apiKey' ? maskApiKey(after[field]) : after[field]
    out.push({ field, from, to })
  }
  return out
}
