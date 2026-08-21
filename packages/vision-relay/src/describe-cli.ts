import pc from 'picocolors'
import { loadConfig, validateConfig } from './config.js'
import { prepareImage } from './images.js'
import { resolveImageInput } from './resolve-source.js'
import { describeImage } from './vision.js'

export interface DescribeCliOptions {
  /** 图片路径、URL、clipboard、recent，或粘贴引用 `#N` */
  image: string
  question?: string
}

/**
 * CLI：同步识别一张图，成功时把描述写到 stdout（便于 /vision 命令 Bash 调用）。
 * 失败时写 stderr 并返回非 0。
 */
export async function describeCli(opts: DescribeCliOptions): Promise<number> {
  const image = opts.image?.trim()
  if (!image) {
    process.stderr.write(
      '用法: vision-relay describe <图片路径|URL|clipboard|recent|#N> [-q 问题]\n' +
        '  例: vision-relay describe ./a.png -q "报错是什么"\n' +
        '  例: vision-relay describe clipboard -q "屏幕上写了什么"\n' +
        '  例: vision-relay describe recent -q "最近一张图"\n' +
        '  例: vision-relay describe "#1" -q "图片是什么"\n',
    )
    return 1
  }
  try {
    const { config, exists } = loadConfig()
    if (!exists) {
      process.stderr.write(pc.yellow('未找到配置，请先运行 vision-relay init\n'))
      return 1
    }
    const errs = validateConfig(config)
    if (errs.length) {
      process.stderr.write(pc.yellow(`配置不完整: ${errs.join('; ')}\n`))
      return 1
    }

    const resolved = await resolveImageInput({
      path: image,
      maxBytes: config.vision.maxImageBytes,
    })
    if (resolved.kind !== 'path' && resolved.kind !== 'url') {
      process.stderr.write(pc.dim(`[vision-relay] ${resolved.label}\n`))
    }

    const prepared = await prepareImage(resolved.image, {
      targetBytes: config.vision.targetImageBytes,
      maxEdge: config.vision.maxImageEdge,
    })
    const text = await describeImage(config.vision, prepared, opts.question)
    if (!text.trim()) {
      process.stderr.write(pc.yellow('视觉模型返回空描述\n'))
      return 1
    }
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
    return 0
  } catch (e) {
    process.stderr.write(pc.red(`[vision-relay] ${(e as Error).message}\n`))
    return 1
  }
}
