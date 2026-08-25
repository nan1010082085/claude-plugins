import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, saveConfig } from '../src/config.js'
import { runClaudeCodeHook } from '../src/hook.js'

const describeImageMock = vi.hoisted(() => vi.fn(async () => '一张报错截图：TypeError: x is not a function'))
vi.mock('../src/vision.js', () => ({ describeImage: describeImageMock }))

let cfgDir: string
let cwd: string
let claudeDir: string

beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), 'vb-hook-'))
  cwd = mkdtempSync(join(tmpdir(), 'vb-hook-cwd-'))
  // 隔离 image-cache，避免读到真实 ~/.claude 的粘贴缓存
  claudeDir = mkdtempSync(join(tmpdir(), 'vb-hook-claude-'))
  process.env.VISION_RELAY_CONFIG_DIR = cfgDir
  process.env.CLAUDE_CONFIG_DIR = claudeDir
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  saveConfig(cfg)
  describeImageMock.mockClear()
})

function withKey(mod: Partial<ReturnType<typeof defaultConfig>>): ReturnType<typeof defaultConfig> {
  const cfg = defaultConfig()
  cfg.vision.apiKey = 'sk-test'
  return Object.assign(cfg, mod)
}

function writePastedImage(sessionId: string, n: number): void {
  const dir = join(claudeDir, 'image-cache', sessionId)
  mkdirSync(dir, { recursive: true })
  // 1x1 红色 PNG
  writeFileSync(join(dir, `${n}.png`), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
}

afterEach(() => {
  delete process.env.VISION_RELAY_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
})

describe('runClaudeCodeHook', () => {
  it('prompt 含真实图片路径时注入描述', async () => {
    writeFileSync(join(cwd, 'shot.png'), 'x')
    const input = JSON.stringify({ prompt: '帮我看看 shot.png 这个报错', cwd })
    const { additionalContext, systemMessage } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('[vision-relay 图片 #1: shot.png]')
    expect(additionalContext).toContain('TypeError: x is not a function')
    expect(systemMessage).toContain('✓ 已识别')
    expect(systemMessage).toContain('shot.png')
    expect(describeImageMock).toHaveBeenCalledTimes(1)
  })

  it('无图片时返回 null 且不调用模型', async () => {
    const { additionalContext, systemMessage } = await runClaudeCodeHook(JSON.stringify({ prompt: '普通问题' }), cwd)
    expect(additionalContext).toBeNull()
    expect(systemMessage).toBeNull()
    expect(describeImageMock).not.toHaveBeenCalled()
  })

  it('单图失败不阻塞，注入失败说明', async () => {
    writeFileSync(join(cwd, 'bad.png'), 'x')
    describeImageMock.mockRejectedValueOnce(new Error('HTTP 500'))
    const { additionalContext, systemMessage } = await runClaudeCodeHook(JSON.stringify({ prompt: '看 bad.png' }), cwd)
    expect(additionalContext).toContain('识别失败: HTTP 500')
    expect(systemMessage).toContain('识别失败')
  })

  it('hook 禁用时直接跳过', async () => {
    saveConfig(withKey({ hook: { enabled: false, maxImages: 4 } }))
    writeFileSync(join(cwd, 'a.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '看 a.png' }), cwd)
    expect(additionalContext).toBeNull()
  })

  it('超过 maxImages 截断', async () => {
    saveConfig(withKey({ hook: { enabled: true, maxImages: 1 } }))
    writeFileSync(join(cwd, 'a.png'), 'x')
    writeFileSync(join(cwd, 'b.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook(JSON.stringify({ prompt: '对比 a.png 和 b.png' }), cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(1)
    expect(additionalContext).toContain('a.png')
  })

  it('非 JSON 输入按纯文本处理', async () => {
    writeFileSync(join(cwd, 'c.png'), 'x')
    const { additionalContext } = await runClaudeCodeHook('看看 c.png', cwd)
    expect(additionalContext).toContain('c.png')
  })

  it('stdin 含 inline base64 图片时直接识别', async () => {
    // 1x1 红色 PNG 的 base64
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const input = JSON.stringify({
      prompt: '[Image #1] 这是什么',
      images: [{ type: 'image', file: { base64: tinyPng, type: 'image/png', originalSize: 67 } }],
    })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('[vision-relay 图片 #1:')
    expect(additionalContext).toContain('TypeError')
    expect(describeImageMock).toHaveBeenCalledTimes(1)
  })

  it('stdin 含 data URI 图片时识别', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const input = JSON.stringify({
      prompt: '[Image #1] 解释一下',
      content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng}` } }],
    })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('[vision-relay 图片 #1:')
    expect(describeImageMock).toHaveBeenCalledTimes(1)
  })

  it('stdin 有 inline 图片时优先于路径扫描', async () => {
    writeFileSync(join(cwd, 'also.png'), 'x')
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const input = JSON.stringify({
      prompt: '看 also.png 和 [Image #1]',
      images: [{ type: 'image', file: { base64: tinyPng, type: 'image/png', originalSize: 67 } }],
    })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    // 应该走 inline 路径，只识别 inline 图片
    expect(describeImageMock).toHaveBeenCalledTimes(1)
    expect(additionalContext).toContain('stdin:image')
  })

  it('[Image #N] 从 image-cache 读取粘贴图片并识别（用户粘贴即用，无需另存文件）', async () => {
    writePastedImage('sess-1', 1)
    const input = JSON.stringify({ session_id: 'sess-1', prompt: '[Image #1] 这个报错怎么修' })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('[vision-relay 粘贴图片 [Image #1]]')
    expect(additionalContext).toContain('TypeError')
    expect(describeImageMock).toHaveBeenCalledTimes(1)
  })

  it('多个 [Image #N] 并行识别', async () => {
    writePastedImage('sess-2', 1)
    writePastedImage('sess-2', 2)
    const input = JSON.stringify({ session_id: 'sess-2', prompt: '[Image #1] 和 [Image #2] 对比一下' })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(2)
    expect(additionalContext).toContain('粘贴图片 [Image #1]')
    expect(additionalContext).toContain('粘贴图片 [Image #2]')
  })

  it('粘贴图片与路径引用混合时一起识别', async () => {
    writePastedImage('sess-3', 1)
    writeFileSync(join(cwd, 'shot.png'), 'x')
    const input = JSON.stringify({ session_id: 'sess-3', prompt: '[Image #1] 和 shot.png 对比' })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(2)
    expect(additionalContext).toContain('粘贴图片 [Image #1]')
    expect(additionalContext).toContain('shot.png')
  })

  it('stdin 缺 session_id 时兜底取最近的 image-cache 目录', async () => {
    writePastedImage('sess-latest', 1)
    const input = JSON.stringify({ prompt: '[Image #1] 这是什么' })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(1)
    expect(additionalContext).toContain('TypeError')
  })

  it('粘贴图片缓存缺失时注入降级提示', async () => {
    const input = JSON.stringify({ session_id: 'sess-gone', prompt: '[Image #1] 这个报错怎么修' })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('[vision-relay]')
    expect(additionalContext).toContain('[Image #1]')
    expect(additionalContext).toContain('clipboard')
    expect(describeImageMock).not.toHaveBeenCalled()
  })

  it('image-cache 缺失时从 transcript_path 读取粘贴图', async () => {
    const sessionId = 'sess-transcript'
    const transcriptDir = join(claudeDir, 'projects', '-tmp-hook-cwd')
    mkdirSync(transcriptDir, { recursive: true })
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-08-24T12:00:00.000Z',
      imagePasteIds: [4],
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '[Image #4] 这个报错怎么修' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: tinyPng },
          },
        ],
      },
    })
    writeFileSync(transcriptPath, `${line}\n`)
    const input = JSON.stringify({
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd,
      prompt: '[Image #4] 这个报错怎么修',
    })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(1)
    expect(additionalContext).toContain('[Image #4]')
    expect(additionalContext).toContain('TypeError')
  })

  it('prompt 含历史 [Image #1] 但只解析到 [Image #4] 时不报全失败', async () => {
    const sessionId = 'sess-partial'
    const transcriptDir = join(claudeDir, 'projects', '-tmp-hook-cwd')
    mkdirSync(transcriptDir, { recursive: true })
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'user',
        timestamp: '2026-08-24T12:00:00.000Z',
        imagePasteIds: [4],
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '[Image #4] 新问题' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: tinyPng },
            },
          ],
        },
      })}\n`,
    )
    const input = JSON.stringify({
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd,
      prompt: '[Image #4] 新问题（附带历史引用 [Image #1]）',
    })
    const { additionalContext, systemMessage } = await runClaudeCodeHook(input, cwd)
    expect(describeImageMock).toHaveBeenCalledTimes(1)
    expect(additionalContext).toContain('[Image #4]')
    expect(systemMessage).toContain('✓')
    expect(additionalContext).not.toContain('未能获取其内容')
  })

  it('[Pasted text #N] 也触发提示', async () => {
    const input = JSON.stringify({ prompt: '[Pasted text #1] 帮我看看' })
    const { additionalContext } = await runClaudeCodeHook(input, cwd)
    expect(additionalContext).toContain('vision-relay')
    expect(describeImageMock).not.toHaveBeenCalled()
  })
})
