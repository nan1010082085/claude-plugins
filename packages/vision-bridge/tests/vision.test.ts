import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../src/config.js'
import { tinyPng } from '../src/images.js'
import {
  anthropicUrl,
  buildAnthropicBody,
  buildOpenAIBody,
  describeImage,
  extractText,
  openaiUrl,
} from '../src/vision.js'

const cfg = defaultConfig()
const img = tinyPng()

describe('URL 规整', () => {
  it('openai', () => {
    expect(openaiUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openaiUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openaiUrl('https://x.com/api/v4/chat/completions')).toBe('https://x.com/api/v4/chat/completions')
  })
  it('anthropic', () => {
    expect(anthropicUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicUrl('https://x.com/v1/messages')).toBe('https://x.com/v1/messages')
  })
})

describe('请求体构造', () => {
  it('openai: data URI + 默认 prompt', () => {
    const body = buildOpenAIBody(cfg.vision, img) as {
      model: string
      max_tokens: number
      messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[]
    }
    expect(body.model).toBe(cfg.vision.model)
    expect(body.max_tokens).toBe(cfg.vision.maxTokens)
    const [textPart, imgPart] = body.messages[0]!.content
    expect(textPart!.text).toBe(cfg.vision.prompt)
    expect(imgPart!.image_url!.url).toMatch(/^data:image\/png;base64,/)
  })
  it('openai: question 覆盖默认 prompt', () => {
    const body = buildOpenAIBody(cfg.vision, img, '这个报错是什么') as {
      messages: { content: { type: string; text?: string }[] }[]
    }
    expect(body.messages[0]!.content[0]!.text).toBe('这个报错是什么')
  })
  it('anthropic: base64 source 块', () => {
    const body = buildAnthropicBody(cfg.vision, img) as {
      messages: { content: { type: string; source?: { type: string; media_type: string; data: string } }[] }[]
    }
    const [imgPart, textPart] = body.messages[0]!.content
    expect(imgPart!.type).toBe('image')
    expect(imgPart!.source).toMatchObject({ type: 'base64', media_type: 'image/png' })
    expect(textPart!.type).toBe('text')
  })
})

describe('extractText', () => {
  it('openai 嵌套结构', () => {
    expect(extractText({ choices: [{ message: { content: 'ok' } }] }, 'openai')).toBe('ok')
  })
  it('anthropic content blocks', () => {
    expect(extractText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }, 'anthropic')).toBe('a\nb')
  })
  it('空响应返回空串', () => {
    expect(extractText({}, 'openai')).toBe('')
    expect(extractText({}, 'anthropic')).toBe('')
  })
})

describe('describeImage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('openai: 正确的 URL/头/解析', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ choices: [{ message: { content: '一张红色测试图' } }] }), { status: 200 })
    }))
    const out = await describeImage(cfg.vision, img)
    expect(out).toBe('一张红色测试图')
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${cfg.vision.apiKey}`)
  })

  it('anthropic: x-api-key 头', async () => {
    const calls: { init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ init })
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'claude 说' }] }), { status: 200 })
    }))
    const out = await describeImage({ ...cfg.vision, type: 'anthropic' }, img)
    expect(out).toBe('claude 说')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe(cfg.vision.apiKey)
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })

  it('HTTP 错误抛出并带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(describeImage(cfg.vision, img)).rejects.toMatchObject({ status: 401 })
  })

  it('空描述抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })))
    await expect(describeImage(cfg.vision, img)).rejects.toThrow('空描述')
  })
})
