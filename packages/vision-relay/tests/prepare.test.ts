import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config.js'
import {
  pngDimensions,
  prepareImage,
  readImageRef,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_TARGET_IMAGE_BYTES,
  tinyPng,
  type ImageInput,
} from '../src/images.js'

async function noisePng(width: number, height: number): Promise<ImageInput> {
  const { Jimp } = await import('jimp')
  const img = new Jimp({ width, height, color: 0x336699ff })
  // 噪点让 PNG 无法压缩，模拟真实大截图
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y += 1) {
      if ((x * 31 + y * 17) % 3 === 0) img.setPixelColor((((x * y) & 0xffffff) | 0xff000000) >>> 0, x, y)
    }
  }
  return { data: await img.getBuffer('image/png'), mediaType: 'image/png', source: 'noise' }
}

describe('pngDimensions', () => {
  it('不解码读取 PNG 尺寸', () => {
    const png = tinyPng()
    expect(pngDimensions(png.data)).toEqual({ width: 1, height: 1 })
  })
  it('非 PNG 返回 null', () => {
    expect(pngDimensions(Buffer.from('hello world, not a png at all'))).toBeNull()
  })
})

describe('prepareImage', () => {
  it('未超限的图片原样透传（字节级一致）', async () => {
    const img = tinyPng()
    const out = await prepareImage(img, { targetBytes: DEFAULT_TARGET_IMAGE_BYTES, maxEdge: 8000 })
    expect(out).toBe(img)
  })

  it('超过 targetBytes 的图片自动压缩为 JPEG 且显著变小', async () => {
    const big = await noisePng(600, 400) // 噪点 PNG，几十 KB 级
    const out = await prepareImage(big, { targetBytes: 5 * 1024, maxEdge: 8000 })
    expect(out.mediaType).toBe('image/jpeg')
    expect(out.data.length).toBeLessThan(big.data.length)
    expect(out.data.length).toBeLessThanOrEqual(5 * 1024)
  })

  it('长边超限自动等比缩小', async () => {
    const wide = await noisePng(500, 50)
    const out = await prepareImage(wide, { targetBytes: DEFAULT_TARGET_IMAGE_BYTES, maxEdge: 200 })
    expect(out.mediaType).toBe('image/jpeg')
    const { Jimp } = await import('jimp')
    const decoded = await Jimp.read(out.data)
    expect(decoded.width).toBeLessThanOrEqual(200)
    // 等比：500x50 -> 200x20
    expect(decoded.height).toBe(20)
  })

  it('jimp 解不了的格式（svg）原样返回不阻断', async () => {
    const svg: ImageInput = { data: Buffer.from('<svg><rect/></svg>'), mediaType: 'image/svg+xml', source: 'x.svg' }
    const out = await prepareImage(svg, { targetBytes: 1, maxEdge: 1 })
    expect(out).toBe(svg)
  })
})

describe('配置默认值', () => {
  it('硬上限 100MB / 压缩目标 5MB / 长边 8000', () => {
    const v = defaultConfig().vision
    expect(v.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES)
    expect(v.targetImageBytes).toBe(DEFAULT_TARGET_IMAGE_BYTES)
    expect(v.maxImageEdge).toBe(8000)
  })
})

describe('readImageRef 硬上限', () => {
  it('超过硬上限拒绝并提示可配置', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vb-big-'))
    const { writeFileSync } = await import('node:fs')
    const big = join(dir, 'big.png')
    writeFileSync(big, Buffer.alloc(2048))
    await expect(readImageRef({ kind: 'path', value: big }, dir, 1024)).rejects.toThrow(/maxImageBytes/)
  })
})
