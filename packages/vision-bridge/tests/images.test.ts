import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findImageRefs, mediaTypeFor, tinyPng } from '../src/images.js'

function tmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vb-test-'))
  return dir
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
