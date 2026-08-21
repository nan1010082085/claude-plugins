import pc from 'picocolors'
import { loadConfig, validateConfig } from './config.js'
import {
  parsePastedImageRef,
  prepareImage,
  readImageRef,
  resolveClaudePastedImagePath,
} from './images.js'
import { describeImage } from './vision.js'

export interface DescribeCliOptions {
  /** 图片路径、URL，或粘贴引用 `#1` / `[Image #1]` */
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
      '用法: vision-relay describe <图片路径|URL|#N> [-q 问题]\n' +
        '  例: vision-relay describe ./a.png -q "报错是什么"\n' +
        '  例: vision-relay describe "#1" -q "图片是什么"   # 读 Claude Code 最近粘贴缓存\n',
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

    let pathOrUrl = image
    const pasted = parsePastedImageRef(image)
    if (pasted !== null) {
      const cached = resolveClaudePastedImagePath(pasted)
      if (!cached) {
        process.stderr.write(
          pc.yellow(
            `未找到粘贴缓存 [Image #${pasted}]。请用文件路径：vision-relay describe ./xxx.png\n` +
              `（缓存目录: ~/.claude/image-cache/<session>/N.png）\n`,
          ),
        )
        return 1
      }
      pathOrUrl = cached
      process.stderr.write(pc.dim(`[vision-relay] 使用粘贴缓存: ${cached}\n`))
    }

    const kind = /^https?:\/\//i.test(pathOrUrl) ? 'url' : 'path'
    const input = await readImageRef({ kind, value: pathOrUrl }, process.cwd(), config.vision.maxImageBytes)
    const prepared = await prepareImage(input, {
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
