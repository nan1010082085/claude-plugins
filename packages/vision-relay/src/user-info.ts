/**
 * 用户可见的简略状态文案（hook systemMessage / MCP 头 / CLI stderr / 会话改写日志）。
 * 详细描述仍走 additionalContext / tool result；此处只让用户知道「调用了视觉、成功与否」。
 */

/** 截短路径/标签，避免刷屏 */
export function shortLabel(source: string, max = 48): string {
  const s = source.trim()
  if (s.length <= max) return s
  if (s.includes('/') || s.includes('\\')) {
    const base = s.replace(/\\/g, '/').split('/').pop() || s
    return base.length <= max ? base : `${base.slice(0, max - 1)}…`
  }
  return `${s.slice(0, max - 1)}…`
}

export interface BriefVisionResult {
  /** 成功识别数 */
  ok: number
  /** 失败数 */
  fail: number
  /** 图源标签（会截短） */
  sources: string[]
  /** 可选：模型名 */
  model?: string
  /** 可选：耗时 ms */
  ms?: number
}

/**
 * 一行用户可见简报。
 * 例：`[vision-relay] ✓ 已识别 2 张图（a.png, clipboard）· 描述已注入上下文`
 */
export function formatVisionBrief(r: BriefVisionResult): string {
  const labels = r.sources.map((s) => shortLabel(s)).join(', ')
  const src = labels ? `（${labels}）` : ''
  const meta: string[] = []
  if (r.model) meta.push(r.model)
  if (r.ms != null && r.ms >= 0) meta.push(`${(r.ms / 1000).toFixed(1)}s`)
  const metaStr = meta.length ? ` · ${meta.join(' · ')}` : ''

  if (r.ok > 0 && r.fail === 0) {
    return `[vision-relay] ✓ 已识别 ${r.ok} 张图${src}${metaStr} · 描述已注入上下文`
  }
  if (r.ok > 0 && r.fail > 0) {
    return `[vision-relay] ⚠ 已识别 ${r.ok} 张、失败 ${r.fail} 张${src}${metaStr} · 成功部分已注入`
  }
  if (r.fail > 0) {
    return `[vision-relay] ✗ 识别失败 ${r.fail} 张${src}${metaStr}`
  }
  return `[vision-relay] （无图片处理）`
}

/** MCP / describe 结果顶部的简报行（后接完整描述） */
export function formatToolResultHeader(opts: {
  source: string
  model?: string
  ms?: number
  chars?: number
}): string {
  const parts = [`source=${shortLabel(opts.source, 64)}`]
  if (opts.model) parts.push(`model=${opts.model}`)
  if (opts.ms != null) parts.push(`${(opts.ms / 1000).toFixed(1)}s`)
  if (opts.chars != null) parts.push(`${opts.chars} 字`)
  return `[vision-relay] ✓ 已识别（${parts.join(' · ')}）`
}
