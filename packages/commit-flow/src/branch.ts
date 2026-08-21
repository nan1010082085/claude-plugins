/**
 * 分支名建议：type/scope-slug 或 type/slug，对齐常见约定。
 */

import type { Classification } from "./types.js";

/**
 * 将标题压成分支安全 slug。
 * @param title - 祈使标题或任意描述
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/**
 * 根据分类与标题草案生成分支名。
 * @param c - 分类结果
 * @param title - 短标题（可不含 type 前缀）
 * @param ticketId - 可选 ticket，优先放在 type 后
 */
export function suggestBranchName(
  c: Classification,
  title: string,
  ticketId?: string | null,
): string {
  const ticket = ticketId ?? c.ticketId;
  const slug = slugify(title) || "change";
  const type = c.type === "chore" ? "chore" : c.type;

  if (ticket) {
    return `${type}/${ticket}-${slug}`.replace(/-+$/g, "");
  }
  if (c.scope) {
    const scopeSlug = slugify(c.scope);
    return `${type}/${scopeSlug}-${slug}`.replace(/-+$/g, "").slice(0, 80);
  }
  return `${type}/${slug}`.slice(0, 80);
}

/**
 * 校验分支名是否大体合法（字母数字、/、-、_）。
 * @param name - 分支名
 */
export function isValidBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(name) &&
    !name.includes("..") &&
    !name.endsWith(".lock");
}
