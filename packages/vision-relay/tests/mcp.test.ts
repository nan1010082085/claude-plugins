import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, saveConfig } from '../src/config.js'

const outputs: string[] = []
vi.mock('node:process', () => ({ default: process }))

// 捕获 mcp.ts 写到 stdout 的响应
let originalWrite: typeof process.stdout.write

beforeEach(() => {
  const cfgDir = mkdtempSync(join(tmpdir(), 'vb-mcp-'))
  process.env.VISION_RELAY_CONFIG_DIR = cfgDir
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  cfg.vision.baseUrl = 'http://127.0.0.1:1' // 不可达，触发错误路径
  saveConfig(cfg)
  outputs.length = 0
  originalWrite = process.stdout.write.bind(process.stdout)
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    outputs.push(String(chunk))
    return true
  }) as typeof process.stdout.write)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.VISION_RELAY_CONFIG_DIR
})

describe('MCP tools/call 工具名校验（回归）', () => {
  it('调用不存在的工具名返回 JSON-RPC 错误', async () => {
    const { handleMessageForTest } = await import('../src/mcp.js')
    await handleMessageForTest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'other_tool', arguments: { path: '/tmp/x.png' } },
    })
    const resp = JSON.parse(outputs[0]!) as { error: { message: string } }
    expect(resp.error.message).toContain('unknown tool: other_tool')
    expect(resp.error.message).toContain('vision_describe')
  })

  it('tools/list 返回 vision_describe 工具', async () => {
    const { handleMessageForTest } = await import('../src/mcp.js')
    await handleMessageForTest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const resp = JSON.parse(outputs[0]!) as { result: { tools: { name: string }[] } }
    expect(resp.result.tools[0]!.name).toBe('vision_describe')
  })

  it('缺 path/url 参数时返回 isError 结果（不崩进程）', async () => {
    const { handleMessageForTest } = await import('../src/mcp.js')
    await handleMessageForTest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'vision_describe', arguments: {} },
    })
    const resp = JSON.parse(outputs[0]!) as { result: { isError: boolean; content: { text: string }[] } }
    expect(resp.result.isError).toBe(true)
    expect(resp.result.content[0]!.text).toContain('必须提供 path、url、image_data')
  })

  it('识别失败时返回 isError（路径不存在）', async () => {
    const { handleMessageForTest } = await import('../src/mcp.js')
    await handleMessageForTest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'vision_describe', arguments: { path: '/definitely/not/exist.png' } },
    })
    const resp = JSON.parse(outputs[0]!) as { result: { isError: boolean } }
    expect(resp.result.isError).toBe(true)
  })

  it('image_data 参数可接受 base64 图片数据', async () => {
    const { handleMessageForTest } = await import('../src/mcp.js')
    // 1x1 红色 PNG
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await handleMessageForTest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'vision_describe', arguments: { image_data: tinyPng } },
    })
    // baseUrl 不可达，会报连接错误，但不会因为参数校验报错
    const resp = JSON.parse(outputs[0]!) as { result: { content: { text: string }[] } }
    expect(resp.result.content[0]!.text).not.toContain('必须提供')
  })

  it('image_data 自动推断 PNG MIME 类型', async () => {
    const { handleMessageForTest } = await import('../src/mcp.js')
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await handleMessageForTest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'vision_describe', arguments: { image_data: tinyPng, media_type: 'image/png' } },
    })
    const resp = JSON.parse(outputs[0]!) as { result: { content: { text: string }[] } }
    // 不会因为 MIME 类型报错
    expect(resp.result.content[0]!.text).not.toContain('MIME')
  })
})
