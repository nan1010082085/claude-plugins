import { spawnSync } from 'node:child_process'
import { isWindows } from './paths.js'

export interface ClaudeCodeInfo {
  /** 纯版本号，如 "2.1.245" */
  version: string
  /** 原始输出行 */
  raw: string
}

/**
 * 运行 `claude --version` 并解析版本号。
 * 找不到 claude 或解析失败时返回 null。
 */
export function getClaudeCodeVersion(): ClaudeCodeInfo | null {
  try {
    const r = spawnSync('claude', ['--version'], {
      encoding: 'utf8',
      shell: isWindows(),
      windowsHide: true,
      timeout: 5000,
    })
    const stdout = r.stdout ?? ''
    if (r.status !== 0 || !stdout) return null
    const raw = stdout.trim()
    // 格式: "2.1.245 (Claude Code)" 或纯 "2.1.245"
    const m = raw.match(/^(\d+\.\d+\.\d+)/)
    if (!m?.[1]) return null
    return { version: m[1], raw }
  } catch {
    return null
  }
}

/**
 * 解析 semver 三段式为可比较的数字元组。
 * 无法解析时返回 [0, 0, 0]。
 */
function parseSemver(v: string): [number, number, number] {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return [0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** a >= b */
function semverGte(a: string, b: string): boolean {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  return pa[0] > pb[0] || (pa[0] === pb[0] && pa[1] > pb[1]) || (pa[0] === pb[0] && pa[1] === pb[1] && pa[2] >= pb[2])
}

/**
 * 已知的 Claude Code hook 兼容性信息。
 * - matcher 要求：2.1.x 某些版本开始要求 UserPromptSubmit hook 带 matcher 字段
 */
export const MIN_MATCHER_VERSION = '2.1.200'

/** 该版本是否需要 hook 配置中带 matcher 字段 */
export function needsMatcherField(version: string): boolean {
  return semverGte(version, MIN_MATCHER_VERSION)
}
