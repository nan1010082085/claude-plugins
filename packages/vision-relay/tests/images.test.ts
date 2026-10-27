import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findImageRefs,
  loadClaudePastedImage,
  mediaTypeFor,
  resolveClaudePastedImagePath,
  resolveClaudePastedImagesPath,
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

/** 创建假的 CC ≥2.1.x 粘贴图目录：<root>/<project 编码>/<session>/images/<n>.png */
function fakePasteImages(
  sessions: Record<string, Record<string, Buffer>>,
  projectKey = '-Users-x-proj',
): string {
  const root = mkdtempSync(join(tmpdir(), 'vr-pastes-'))
  for (const [sess, files] of Object.entries(sessions)) {
    const dir = join(root, projectKey, sess, 'images')
    mkdirSync(dir, { recursive: true })
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(join(dir, name), data)
    }
  }
  return root
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

describe('resolveClaudePastedImagesPath — CC ≥2.1.x 落盘布局', () => {
  const pngData = Buffer.from(tinyPng().data)

  it('按 cwd 编码 + sessionId 精确定位', () => {
    const root = fakePasteImages({ sessionA: { '1.png': pngData }, sessionB: { '1.png': pngData } })
    const p = resolveClaudePastedImagesPath(1, 'sessionB', '/Users/x/proj', [root])
    expect(p).toContain('sessionB')
    expect(p).toContain('1.png')
  })

  it('cwd 编码不符时枚举项目目录仍能命中', () => {
    const root = fakePasteImages({ sessionA: { '2.png': pngData } })
    const p = resolveClaudePastedImagesPath(2, 'sessionA', '/somewhere/else', [root])
    expect(p).toContain('sessionA')
    expect(p).toContain('2.png')
  })

  it('跨会话兜底取 mtime 更新的文件', () => {
    const root = fakePasteImages({ oldSession: { '3.png': pngData }, newSession: { '3.png': pngData } })
    const oldFile = join(root, '-Users-x-proj', 'oldSession', 'images', '3.png')
    const newFile = join(root, '-Users-x-proj', 'newSession', 'images', '3.png')
    utimesSync(oldFile, new Date('2025-01-01'), new Date('2025-01-01'))
    utimesSync(newFile, new Date('2025-06-01'), new Date('2025-06-01'))
    const p = resolveClaudePastedImagesPath(3, undefined, undefined, [root])
    expect(p).toContain('newSession')
  })

  it('所有目录都没有时返回 null', () => {
    const root = fakePasteImages({ s1: {} })
    expect(resolveClaudePastedImagesPath(99, 's1', undefined, [root])).toBeNull()
    expect(resolveClaudePastedImagesPath(1, undefined, undefined, [])).toBeNull()
  })
})

describe('loadClaudePastedImage — CC ≥2.1.x 新落盘（粘贴当轮回归）', () => {
  const pngData = Buffer.from(tinyPng().data)

  it('transcript 尚未落库时从新版 images 目录读取（UserPromptSubmit hook 当轮场景）', () => {
    const root = fakePasteImages({ sessionA: { '20.png': pngData } })
    // 模拟 hook 时刻：当前消息（含 [Image #20] 文本）已存在，但图片 base64 尚未写入 transcript
    const currentTranscript = fakeTranscript([
      { type: 'user', timestamp: '2025-01-02T00:00:00Z', message: { content: [{ type: 'text', text: '看图 [Image #20]' }] } },
    ])
    const emptyCache = fakeImageCache({})
    const result = loadClaudePastedImage(20, 1024 * 1024, 'sessionA', currentTranscript, '/Users/x/proj', [currentTranscript], emptyCache, [root])
    expect(result).not.toBeNull()
    expect(result!.data).toEqual(pngData)
    expect(result!.source).toContain('[Image #20]')
  })

  it('新版 images 目录优先于 transcript 兜底', () => {
    const diskPng = Buffer.from('disk-image-bytes')
    const root = fakePasteImages({ sessionA: { '5.png': diskPng } })
    const transcript = fakeTranscript([
      {
        type: 'user',
        timestamp: '2025-01-01T00:00:00Z',
        message: { content: [{ type: 'text', text: '[Image #5]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngData.toString('base64') } }] },
        imagePasteIds: [5],
      },
    ])
    const emptyCache = fakeImageCache({})
    const result = loadClaudePastedImage(5, 1024 * 1024, 'sessionA', transcript, '/Users/x/proj', [transcript], emptyCache, [root])
    expect(result).not.toBeNull()
    expect(result!.data).toEqual(diskPng)
    expect(result!.source).toContain('粘贴图片')
  })

  it('cacheRoot 隔离模式下不扫真实系统目录', () => {
    // 未注入 pasteRoots 且注入 cacheRoot → 新版目录查找被跳过，落回 transcript 兜底
    const transcript = fakeTranscript([
      {
        type: 'user',
        timestamp: '2025-01-01T00:00:00Z',
        message: { content: [{ type: 'text', text: '[Image #7]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngData.toString('base64') } }] },
        imagePasteIds: [7],
      },
    ])
    const emptyCache = fakeImageCache({})
    const result = loadClaudePastedImage(7, 1024 * 1024, 'sessionA', transcript, '/Users/x/proj', [transcript], emptyCache)
    expect(result).not.toBeNull()
    expect(result!.source).toContain('transcript')
  })
})
