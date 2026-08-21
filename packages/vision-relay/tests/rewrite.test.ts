import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config.js'
import {
  assertPublicHttpUrl,
  estimateBase64Bytes,
  imageFromBlock,
  isChatPath,
  isImageLikeBlock,
  rewriteRequestBody,
} from '../src/rewrite.js'
import { TINY_PNG_BASE64 } from '../src/images.js'

describe('rewrite helpers', () => {
  it('isChatPath 识别对话路径', () => {
    expect(isChatPath('/v1/messages')).toBe(true)
    expect(isChatPath('/api/coding/v1/messages')).toBe(true)
    expect(isChatPath('/v1/chat/completions')).toBe(true)
    expect(isChatPath('/healthz')).toBe(false)
  })

  it('assertPublicHttpUrl 拒绝私网与非 http', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/x.png')).toThrow(/私网|本机/)
    expect(() => assertPublicHttpUrl('http://192.168.1.1/x.png')).toThrow(/私网|本机/)
    expect(() => assertPublicHttpUrl('http://[::1]/x.png')).toThrow(/私网|本机/)
    expect(() => assertPublicHttpUrl('http://[::ffff:127.0.0.1]/x.png')).toThrow(/私网|本机/)
    expect(() => assertPublicHttpUrl('file:///tmp/a.png')).toThrow(/协议/)
    expect(assertPublicHttpUrl('https://example.com/a.png').hostname).toBe('example.com')
  })

  it('超大 base64 估大小并拒绝解码进 imageFromBlock', () => {
    const huge = 'A'.repeat(100)
    expect(estimateBase64Bytes(huge)).toBeGreaterThan(0)
    const block = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(1000) },
    }
    expect(imageFromBlock(block, 10)).toBeNull()
    expect(isImageLikeBlock(block)).toBe(true)
  })
})

describe('rewriteRequestBody', () => {
  it('将 Anthropic image block 替换为文字且不放行原图', async () => {
    const cfg = defaultConfig()
    cfg.vision.apiKey = 'test-key'
    // 不真正打 API：用无效 key 会走失败占位
    cfg.vision.baseUrl = 'http://127.0.0.1:9'
    cfg.vision.timeoutMs = 50

    const body = {
      model: 'x',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_BASE64 },
            },
            { type: 'text', text: '这是什么' },
          ],
        },
      ],
    }

    const { body: out, rewritten } = await rewriteRequestBody(cfg, body, new Map())
    expect(rewritten).toBeGreaterThanOrEqual(1)
    const content = (out as { messages: { content: unknown[] }[] }).messages[0]!.content
    expect(content.some((b) => (b as { type?: string }).type === 'image')).toBe(false)
    const text = content.find((b) => (b as { type?: string }).type === 'text' && String((b as { text?: string }).text).startsWith('[vision-relay]'))
    expect(text).toBeTruthy()
  })

  it('无法解析的 image 块也替换为占位', async () => {
    const cfg = defaultConfig()
    cfg.vision.apiKey = 'k'
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: { type: 'unknown' } }],
        },
      ],
    }
    const { body: out } = await rewriteRequestBody(cfg, body, new Map())
    const content = (out as { messages: { content: unknown[] }[] }).messages[0]!.content
    expect(content).toHaveLength(1)
    expect((content[0] as { type: string }).type).toBe('text')
    expect(String((content[0] as { text: string }).text)).toContain('[vision-relay]')
  })
})
