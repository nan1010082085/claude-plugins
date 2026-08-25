import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TINY_PNG_BASE64 } from '../src/images.js'
import { resolveImageInput, resolveRecentImagePath } from '../src/resolve-source.js'

describe('resolveImageInput', () => {
  it('解析本地路径', async () => {
    const dir = join(tmpdir(), `vr-src-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'a.png')
    writeFileSync(p, Buffer.from(TINY_PNG_BASE64, 'base64'))
    const r = await resolveImageInput({ path: p, maxBytes: 1_000_000 })
    expect(r.kind).toBe('path')
    expect(r.image.data.length).toBeGreaterThan(0)
  })

  it('解析 #N 粘贴缓存', async () => {
    const home = join(tmpdir(), `vr-home-${Date.now()}`)
    const session = 'sess1'
    const cache = join(home, '.claude', 'image-cache', session)
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, '1.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    process.env.HOME = home
    process.env.CLAUDE_CONFIG_DIR = join(home, '.claude')
    const r = await resolveImageInput({ path: '#1', maxBytes: 1_000_000 })
    expect(r.kind).toBe('pasted')
    expect(r.label).toContain('Image #1')
  })

  it('recent 找到最近缓存', async () => {
    const home = join(tmpdir(), `vr-home2-${Date.now()}`)
    const cache = join(home, '.claude', 'image-cache', 's2')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, '2.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    process.env.CLAUDE_CONFIG_DIR = join(home, '.claude')
    expect(resolveRecentImagePath()).toContain('2.png')
    const r = await resolveImageInput({ path: 'recent', maxBytes: 1_000_000 })
    expect(r.kind).toBe('recent')
  })

  it('recent 从 transcript jsonl 兜底（无 image-cache）', async () => {
    const home = join(tmpdir(), `vr-home3-${Date.now()}`)
    const claudeDir = join(home, '.claude')
    const transcriptDir = join(claudeDir, 'projects', '-tmp-recent')
    mkdirSync(transcriptDir, { recursive: true })
    const transcriptPath = join(transcriptDir, 'sess-recent.jsonl')
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'user',
        timestamp: '2026-08-24T12:00:00.000Z',
        imagePasteIds: [1],
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: TINY_PNG_BASE64,
              },
            },
          ],
        },
      })}\n`,
    )
    process.env.CLAUDE_CONFIG_DIR = claudeDir
    const r = await resolveImageInput({ path: 'recent', maxBytes: 1_000_000, transcriptPath })
    expect(r.kind).toBe('recent')
    expect(r.image.data.length).toBeGreaterThan(0)
  })

  it('缺参数抛错并提示 clipboard', async () => {
    await expect(resolveImageInput({ maxBytes: 100 })).rejects.toThrow(/clipboard/)
  })
})
