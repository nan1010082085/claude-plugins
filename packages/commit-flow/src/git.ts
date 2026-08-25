/**
 * 轻量 git 封装：供 CLI 读取状态与分类上下文（不在此自动 push）。
 */

import { execFileSync } from "node:child_process";

/** git 执行选项 */
export interface GitOpts {
  cwd?: string;
}

/**
 * 同步执行 git 子命令。
 * @param args - git 参数
 * @param opts - cwd 等
 */
function git(args: string[], opts: GitOpts = {}): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString() ?? "";
    throw new Error(stderr || e.message || `git ${args.join(" ")} failed`);
  }
}

/**
 * 当前分支名。
 * @param opts - git 选项
 */
export function currentBranch(opts?: GitOpts): string {
  return git(["branch", "--show-current"], opts);
}

/**
 * 已暂存文件列表。
 * @param opts - git 选项
 */
export function stagedFiles(opts?: GitOpts): string[] {
  const out = git(["diff", "--cached", "--name-only"], opts);
  return out ? out.split("\n").filter(Boolean) : [];
}

/**
 * 已暂存 diff 全文。
 * @param opts - git 选项
 */
export function stagedDiff(opts?: GitOpts): string {
  return git(["diff", "--cached"], opts);
}

/**
 * 已暂存 numstat。
 * @param opts - git 选项
 */
export function stagedNumstat(opts?: GitOpts): string {
  return git(["diff", "--cached", "--numstat"], opts);
}

/**
 * porcelain 状态。
 * @param opts - git 选项
 */
export function statusPorcelain(opts?: GitOpts): string {
  return git(["status", "--porcelain"], opts);
}

/**
 * 未推送到 upstream 的 commits（无 upstream 时返回空并注明）。
 * @param opts - git 选项
 */
export function unpushedLog(opts?: GitOpts): { ok: boolean; log: string; hint?: string } {
  try {
    const log = git(["log", "@{u}..HEAD", "--oneline"], opts);
    return { ok: true, log };
  } catch {
    return {
      ok: false,
      log: "",
      hint: "No upstream configured. Set upstream or use: git push -u origin HEAD",
    };
  }
}

/**
 * 创建 commit（message 经 stdin -F -，避免 shell 转义问题）。
 * @param message - 完整 commit message
 * @param opts - git 选项
 */
export function commitWithMessage(message: string, opts?: GitOpts): string {
  return execFileSync("git", ["commit", "-F", "-"], {
    encoding: "utf-8",
    cwd: opts?.cwd ?? process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    input: message,
  }).trim();
}

/**
 * 推送到当前 upstream（或 origin HEAD）。
 * @param opts - git 选项
 * @param setUpstream - 无 upstream 时是否 `-u origin HEAD`
 */
export function push(opts?: GitOpts, setUpstream = false): string {
  if (setUpstream) {
    return git(["push", "-u", "origin", "HEAD"], opts);
  }
  return git(["push"], opts);
}

/**
 * 暂存全部（`git add -A`）。
 * @param opts - git 选项
 */
export function addAll(opts?: GitOpts): void {
  git(["add", "-A"], opts);
}

/**
 * 本地是否已有该分支。
 * @param name - 分支名
 * @param opts - git 选项
 */
export function branchExists(name: string, opts?: GitOpts): boolean {
  try {
    git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * 基于当前 HEAD 创建并切换到新分支（`git checkout -b`）。
 * @param name - 新分支名
 * @param opts - git 选项
 */
export function createBranch(name: string, opts?: GitOpts): string {
  return git(["checkout", "-b", name], opts);
}

/**
 * 最近一次 commit 的 subject。
 * @param opts - git 选项
 */
export function lastCommitSubject(opts?: GitOpts): string {
  return git(["log", "-1", "--pretty=%s"], opts);
}
