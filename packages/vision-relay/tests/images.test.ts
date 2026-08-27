import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findImageRefs,
  loadClaudePastedImage,
  mediaTypeFor,
  resolveClaudePastedImagePath,
  tinyPng,
} from '../src/images.js'

function tmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vb-test-'))
  return dir
}

/** 创建假的 image-cache 目录结构：~/.claude/image-cache/<session>/<n>.png */
function fakeImageCache(sessions: Record<string, Record<string, Buffer>>): string {
  const root = mkdtempSync(join(tmpdir(), 'vr-cache-'))
  for (const [sess, files] of Object.entries(sessions)) {
    const dir = join(root, sess)
    mkdirSync(dir, { recursive: true })
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(join(dir, name), data)
    }
  }
  return root
}

/** 创建假的 transcript jsonl（单行 JSON） */
function fakeTranscript(entries: Array<Record<string, unknown>>): string {
  const file = join(mkdtempSync(join(tmpdir(), 'vr-tr-')), 'session.jsonl')
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'))
  return file
}

describe('mediaTypeFor', () => {
  it('按扩展名映射', () => {
    expect(mediaTypeFor('a.png')).toBe('image/png')
    expect(mediaTypeFor('a.JPG')).toBe('image/jpeg')
    expect(mediaTypeFor('a.jpeg')).toBe('image/jpeg')
    expect(mediaTypeFor('a.webp')).toBe('image/webp')
    expect(mediaTypeFor('a.svg')).toBe('image/svg+xml')
    expect(mediaTypeFor('http://x.com/a.png?token=1')).toBe('image/png')
    expect(mediaTypeFor('a.txt')).toBeUndefined()
  })
})

describe('findImageRefs', () => {
  it('提取真实存在的本地路径（绝对/相对/~）', () => {
    const cwd = tmpCwd()
    mkdirSync(join(cwd, 'shots'))
    writeFileSync(join(cwd, 'shots', 'err.png'), 'x')
    const text = '看下 ./shots/err.png 和 shots/err.png 这张报错，还有不存在的 ./shots/none.png'
    const refs = findImageRefs(text, cwd)
    expect(refs).toEqual([
      { kind: 'path', value: './shots/err.png' },
      { kind: 'path', value: 'shots/err.png' },
    ])
  })

  it('提取图片 URL 并去重', () => {
    const refs = findImageRefs('图在 https://a.com/x.png 和 https://a.com/x.png. 其他见 https://a.com/doc', tmpCwd())
    expect(refs).toEqual([{ kind: 'url', value: 'https://a.com/x.png' }])
  })

  it('尾部标点不破坏 URL 扩展名', () => {
    const refs = findImageRefs('见 https://a.com/x.png。', tmpCwd())
    expect(refs).toEqual([{ kind: 'url', value: 'https://a.com/x.png' }])
  })

  it('不存在的裸文件名不算引用', () => {
    const refs = findImageRefs('错误 error.png 出现了', tmpCwd())
    expect(refs).toEqual([])
  })

  it('无图片文本返回空', () => {
    expect(findImageRefs('普通的中文提示词，没有任何图片。', tmpCwd())).toEqual([])
  })
})

describe('tinyPng', () => {
  it('是合法的 1x1 PNG', () => {
    const png = tinyPng()
    expect(png.mediaType).toBe('image/png')
    expect(png.data.length).toBeGreaterThan(8)
    expect(png.data.subarray(1, 4).toString()).toBe('PNG')
  })
})

describe('resolveClaudePastedImagePath — 跨会话搜索', () => {
  const pngData = Buffer.from(tinyPng().data)

  it('优先匹配指定 sessionId', () => {
    const root = fakeImageCache({ sessionA: { '1.png': pngData }, sessionB: { '1.png': pngData } })
    const p = resolveClaudePastedImagePath(1, 'sessionA', root)
    expect(p).toContain('sessionA')
  })

  it('指定 sessionId 无匹配时，搜索其他 session 目录', () => {
    const root = fakeImageCache({ otherSession: { '3.png': pngData } })
    const p = resolveClaudePastedImagePath(3, 'nonexistentSession', root)
    expect(p).toContain('otherSession')
    expect(p).toContain('3.png')
  })

  it('无 sessionId 时搜索全部目录', () => {
    const root = fakeImageCache({ s1: { '2.png': pngData } })
    const p = resolveClaudePastedImagePath(2, undefined, root)
    expect(p).toContain('2.png')
  })

  it('所有目录都没有时返回 null', () => {
    const root = fakeImageCache({ s1: {} })
    expect(resolveClaudePastedImagePath(99, 's1', root)).toBeNull()
  })
})

describe('loadClaudePastedImage — 全局 transcript 回退', () => {
  const pngData = Buffer.from(tinyPng().data)
  const b64 = pngData.toString('base64')

  it('指定 transcript 无匹配时，搜索全部 transcript', () => {
    // 旧会话的 transcript 包含图片
    const oldTranscript = fakeTranscript([
      {
        type: 'user',
        timestamp: '2025-01-01T00:00:00Z',
        message: { content: [{ type: 'text', text: '[Image #1]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }] },
        imagePasteIds: [1],
      },
    ])
    // 当前会话的 transcript 不包含图片
    const currentTranscript = fakeTranscript([
      { type: 'user', timestamp: '2025-01-02T00:00:00Z', message: { content: [{ type: 'text', text: 'hello' }] } },
    ])

    // cacheRoot 指向空目录，allTranscripts 注入假 transcript 列表
    const emptyCache = fakeImageCache({})
    const result = loadClaudePastedImage(1, 1024 * 1024, 'currentSession', currentTranscript, undefined, [oldTranscript, currentTranscript], emptyCache)
    expect(result).not.toBeNull()
    expect(result!.data).toEqual(pngData)
    expect(result!.source).toContain('transcript')
  })

  it('全局 transcript 也没有时返回 null', () => {
    const emptyTranscript = fakeTranscript([
      { type: 'user', timestamp: '2025-01-02T00:00:00Z', message: { content: [{ type: 'text', text: 'no image here' }] } },
    ])
    const emptyCache = fakeImageCache({})
    const result = loadClaudePastedImage(99, 1024 * 1024, 'noSession', emptyTranscript, undefined, [emptyTranscript], emptyCache)
    expect(result).toBeNull()
  })
})
