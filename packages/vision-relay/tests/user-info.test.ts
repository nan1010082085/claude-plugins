import { describe, expect, it } from 'vitest'
import { formatToolResultHeader, formatVisionBrief, shortLabel } from '../src/user-info.js'

describe('user-info', () => {
  it('shortLabel 截短长路径', () => {
    expect(shortLabel('shot.png')).toBe('shot.png')
    expect(shortLabel('/a/b/very-long-name.png', 20)).toBe('very-long-name.png')
  })

  it('formatVisionBrief 成功/失败文案', () => {
    expect(formatVisionBrief({ ok: 1, fail: 0, sources: ['a.png'], model: 'v', ms: 1200 })).toContain('✓ 已识别 1 张图')
    expect(formatVisionBrief({ ok: 1, fail: 0, sources: ['a.png'] })).toContain('描述已注入上下文')
    expect(formatVisionBrief({ ok: 1, fail: 1, sources: ['a.png', 'b.png'] })).toContain('失败 1')
    expect(formatVisionBrief({ ok: 0, fail: 2, sources: ['x'] })).toContain('✗ 识别失败')
  })

  it('formatToolResultHeader', () => {
    const h = formatToolResultHeader({ source: 'clipboard', model: 'glm', ms: 800, chars: 42 })
    expect(h).toContain('✓ 已识别')
    expect(h).toContain('clipboard')
    expect(h).toContain('0.8s')
  })
})
