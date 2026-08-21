import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config.js'
import { TINY_PNG_BASE64 } from '../src/images.js'
import { startSessionProxy } from '../src/session-proxy.js'

describe('session-proxy', () => {
  const servers: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop()
      await s?.close()
    }
  })

  it('healthz + 改写 messages 后转发上游', async () => {
    let receivedBody = ''
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }))
      })
    })
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()))
    const upPort = (upstream.address() as { port: number }).port
    servers.push({
      close: () =>
        new Promise((resolve, reject) => upstream.close((e) => (e ? reject(e) : resolve()))),
    })

    const cfg = defaultConfig()
    cfg.vision.apiKey = 'k'
    cfg.vision.baseUrl = 'http://127.0.0.1:9'
    cfg.vision.timeoutMs = 30

    const proxy = await startSessionProxy({
      config: cfg,
      upstreamBaseUrl: `http://127.0.0.1:${upPort}`,
      allowLoopbackUpstream: true,
    })
    servers.push(proxy)

    const hz = await fetch(`${proxy.baseUrl}/healthz`)
    expect(hz.ok).toBe(true)

    const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: 'm',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_BASE64 },
              },
              { type: 'text', text: 'hi' },
            ],
          },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const parsed = JSON.parse(receivedBody) as {
      messages: { content: { type: string }[] }[]
    }
    expect(parsed.messages[0]!.content.some((b) => b.type === 'image')).toBe(false)
    expect(parsed.messages[0]!.content.some((b) => b.type === 'text')).toBe(true)
  })

  it('拒绝本机上游（防环路，含 IPv4-mapped）', async () => {
    await expect(
      startSessionProxy({
        config: defaultConfig(),
        upstreamBaseUrl: 'http://127.0.0.1:8347',
      }),
    ).rejects.toThrow(/环路|本机/)
    await expect(
      startSessionProxy({
        config: defaultConfig(),
        upstreamBaseUrl: 'http://[::ffff:127.0.0.1]:8347',
      }),
    ).rejects.toThrow(/环路|本机/)
  })
})
