/**
 * Conventional Commits 类型与分类输入/输出类型。
 */

/** 支持的 commit type（优先级见 classify） */
export type CommitType =
  | "revert"
  | "fix"
  | "feat"
  | "perf"
  | "refactor"
  | "docs"
  | "style"
  | "test"
  | "build"
  | "ci"
  | "chore";

/** 分类置信度 */
export type Confidence = "high" | "medium" | "low";

/** 分类器输入 */
export interface ClassifyInput {
  /** 已暂存文件路径（相对仓库根） */
  files: string[];
  /** `git diff --cached` 全文 */
  diff: string;
  /** 当前分支名，用于提取 ticket */
  branch?: string;
}

/** 分类结果 */
export interface Classification {
  type: CommitType;
  scope: string | null;
  isBreaking: boolean;
  confidence: Confidence;
  ticketId: string | null;
  reasons: string[];
}

/** 行数统计 */
export interface DiffStats {
  files: number;
  added: number;
  removed: number;
}

/** 类型 emoji 映射 */
export const TYPE_EMOJIS: Record<CommitType, string> = {
  feat: "✨",
  fix: "🐛",
  docs: "📝",
  style: "💄",
  refactor: "♻️",
  perf: "⚡",
  test: "✅",
  build: "📦",
  ci: "🔧",
  chore: "🔨",
  revert: "⏪",
};
