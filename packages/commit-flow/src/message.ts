/**
 * 拼装 Conventional Commits 消息模板（分类器部分；模型再补 why/impact）。
 */

import type { Classification, DiffStats } from "./types.js";
import { TYPE_EMOJIS } from "./types.js";

/** 消息拼装选项 */
export interface BuildMessageOptions {
  classification: Classification;
  /** 标题（祈使语气，不含 type/scope 前缀） */
  title: string;
  /** 模型填写的「为什么 / 改了什么」正文 */
  why?: string;
  /** 模型填写的影响说明 */
  impact?: string;
  /** 文件变更统计 */
  stats?: DiffStats;
  /** 额外 footer 行 */
  footers?: string[];
  /** Co-author 署名（如 "Claude <noreply@anthropic.com>"）；省略则不加 */
  coAuthor?: string;
}

/**
 * 生成标题行：`type(scope)!: title`
 * @param c - 分类结果
 * @param title - 短标题
 */
export function formatSubject(c: Classification, title: string): string {
  const bang = c.isBreaking ? "!" : "";
  const scope = c.scope ? `(${c.scope})` : "";
  const clean = title.replace(/^\s+|\s+$/g, "").replace(/\.$/, "");
  return `${c.type}${scope}${bang}: ${clean}`;
}

/**
 * 生成完整 commit message（含 Summary / Impact 骨架）。
 * @param opts - 拼装选项
 */
export function buildCommitMessage(opts: BuildMessageOptions): string {
  const { classification: c, title, why, impact, stats, footers = [] } = opts;
  const subject = formatSubject(c, title);
  const emoji = TYPE_EMOJIS[c.type];

  const bodyParts: string[] = [];

  if (why?.trim()) {
    bodyParts.push(why.trim());
  } else {
    bodyParts.push(
      `${emoji} ${c.reasons[0] ?? "Update codebase"}.`,
      "",
      "（请由模型补充：为什么改、关键改动要点）",
    );
  }

  if (stats) {
    bodyParts.push(
      "",
      "Summary:",
      `- Files: ${stats.files} (+${stats.added} / -${stats.removed})`,
      `- Type: ${c.type}${c.scope ? ` / scope: ${c.scope}` : ""}`,
      `- Confidence: ${c.confidence}`,
    );
  }

  if (impact?.trim()) {
    bodyParts.push("", "Impact:", impact.trim());
  } else {
    bodyParts.push("", "Impact:", "- （请由模型补充影响与风险）");
  }

  const footerLines: string[] = [...footers];
  if (c.isBreaking && !footerLines.some((l) => l.startsWith("BREAKING CHANGE"))) {
    footerLines.unshift("BREAKING CHANGE: see commit body");
  }
  if (c.ticketId) {
    footerLines.push(`Refs: ${c.ticketId}`);
  }
  if (opts.coAuthor) {
    footerLines.push(`Co-authored-by: ${opts.coAuthor}`);
  }

  return [subject, "", ...bodyParts, "", ...footerLines].join("\n");
}

/**
 * 从 diff 文件名与 numstat 行解析统计（供 CLI 使用）。
 * @param numstat - `git diff --cached --numstat` 输出
 */
export function parseNumstat(numstat: string): DiffStats {
  const lines = numstat
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let added = 0;
  let removed = 0;
  for (const line of lines) {
    const [a, r] = line.split("\t");
    added += a === "-" ? 0 : Number.parseInt(a ?? "0", 10) || 0;
    removed += r === "-" ? 0 : Number.parseInt(r ?? "0", 10) || 0;
  }

  return { files: lines.length, added, removed };
}

/**
 * 根据文件路径生成默认短标题草案（模型应改写为更好的祈使句）。
 * @param c - 分类
 * @param files - 文件列表
 */
export function draftTitle(c: Classification, files: string[]): string {
  if (files.length === 1) {
    const name = files[0]!.split("/").pop() ?? files[0]!;
    return `update ${name}`;
  }
  if (c.scope) return `update ${c.scope}`;
  return `update ${files.length} files`;
}
