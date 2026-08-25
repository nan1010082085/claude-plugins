/**
 * 基于暂存文件与 diff 的 Conventional Commits 分类器（纯函数，不调 git）。
 */

import type {
  Classification,
  ClassifyInput,
  CommitType,
  Confidence,
} from "./types.js";

const TICKET_RE = /[A-Z]+-\d+/;

/**
 * 判断路径是否像测试文件。
 * @param file - 文件路径
 */
function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[^/]+$|__tests__\/|\/tests?\/|^tests?\//.test(file);
}

/**
 * 判断路径是否像文档。
 * @param file - 文件路径
 */
function isDocFile(file: string): boolean {
  return (
    /\.(md|txt|rst|adoc)$/i.test(file) ||
    /^docs\//i.test(file) ||
    /^(README|CHANGELOG|LICENSE)/i.test(file)
  );
}

/**
 * 判断路径是否像样式/格式配置。
 * @param file - 文件路径
 */
function isStyleFile(file: string): boolean {
  return /\.(css|scss|less|sass)$/i.test(file) ||
    /\.eslintrc|\.prettierrc|\.stylelintrc/.test(file);
}

/**
 * 判断路径是否像构建/依赖配置。
 * @param file - 文件路径
 */
function isBuildFile(file: string): boolean {
  return /package\.json|package-lock\.json|yarn\.lock|pnpm-lock|tsconfig|webpack|vite\.config|rollup|babel|\.cargo|Makefile|CMakeLists|build\.gradle|pom\.xml/.test(
    file,
  );
}

/**
 * 判断路径是否像 CI 配置。
 * @param file - 文件路径
 */
function isCiFile(file: string): boolean {
  return /\.github\/|\.gitlab-ci|Jenkinsfile|\.travis|\.circleci|\.azure-pipelines|bitbucket-pipelines/.test(
    file,
  );
}

/**
 * 从目录结构推断 scope。
 * @param files - 已暂存文件
 */
function detectScope(files: string[]): string | null {
  if (files.length === 0) return null;

  const first = files[0]!;
  const dir = first.includes("/") ? first.slice(0, first.lastIndexOf("/")) : "";

  const mappings: Array<[RegExp, string]> = [
    [/(^|\/)(src\/)?api(\/|$)/, "api"],
    [/(^|\/)(src\/)?(ui|components)(\/|$)/, "ui"],
    [/(^|\/)(src\/)?auth(\/|$)/, "auth"],
    [/(^|\/)(src\/)?(db|database)(\/|$)/, "db"],
    [/(^|\/)(src\/)?config(\/|$)/, "config"],
    [/(^|\/)(src\/)?(utils|helpers)(\/|$)/, "utils"],
    [/(^|\/)(src\/)?hooks(\/|$)/, "hooks"],
    [/(^|\/)(src\/)?(pages|views)(\/|$)/, "pages"],
    [/(^|\/)(src\/)?services(\/|$)/, "services"],
    [/(^|\/)(src\/)?(models|schemas)(\/|$)/, "models"],
    [/(^|\/)(src\/)?middleware(\/|$)/, "middleware"],
    [/(^|\/)packages\/([^/]+)/, "$2"],
  ];

  for (const [re, scope] of mappings) {
    const m = dir.match(re) ?? first.match(re);
    if (m) {
      return scope.startsWith("$") ? (m[2] ?? m[1] ?? null) : scope;
    }
  }

  // packages/foo → foo
  const pkg = first.match(/^packages\/([^/]+)/);
  if (pkg?.[1]) return pkg[1];

  const base = first.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (base.length > 0 && base.length < 15) return base.toLowerCase();
  return null;
}

/**
 * 从分支名提取 JIRA 风格 ticket。
 * @param branch - 分支名
 */
function extractTicket(branch: string | undefined): string | null {
  if (!branch) return null;
  const m = branch.match(TICKET_RE);
  return m?.[0] ?? null;
}

/**
 * 检测是否可能为 breaking change。
 * @param diff - staged diff
 */
function detectBreaking(diff: string): boolean {
  if (/BREAKING CHANGE|breaking:|!:/i.test(diff)) return true;
  // 删除 export/public API 的粗略启发式
  return /^-.*(export (async )?function|export class|export (const|type|interface))/m.test(
    diff,
  );
}

/**
 * 按优先级对暂存变更分类。
 * @param input - 文件列表、diff、分支
 */

/**
 * 从 unified diff 中提取新增行（以 + 开头但非 +++），限制关键词扫描范围。
 */
function addedLines(diff: string): string {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
}

export function classify(input: ClassifyInput): Classification {
  const { files, diff, branch } = input;
  const reasons: string[] = [];
  let type: CommitType | null = null;
  let confidence: Confidence = "medium";

  const total = files.length;
  const testCount = files.filter(isTestFile).length;
  const docCount = files.filter(isDocFile).length;

  // 文件类型排他检查优先：全部是测试/文档时直接定性，不受 diff 关键词干扰
  if (!type && total > 0 && testCount === total) {
    type = "test";
    reasons.push("Only test files changed");
    confidence = "high";
  }

  if (!type && total > 0 && docCount === total) {
    type = "docs";
    reasons.push("Only documentation files changed");
    confidence = "high";
  }

  // 关键词仅扫描新增行，避免删除代码中的词误触发分类
  const added = addedLines(diff);

  if (!type && /(?:revert|undo|rollback)/i.test(added.slice(0, 2000))) {
    type = "revert";
    reasons.push("Changes appear to revert previous commits");
    confidence = "high";
  }

  if (!type && /\b(fix|bug|issue|error|crash|resolve|patch|broken|incorrect)\b/i.test(added)) {
    type = "fix";
    reasons.push("Changes address bugs or errors");
    confidence = "high";
  }

  if (!type && /\b(add|implement|create|new|feature|support|introduce)\b/i.test(added)) {
    type = "feat";
    reasons.push("Changes add new functionality");
    confidence = "high";
  }

  if (!type && /\b(performance|optimize|speed|fast|cache|lazy|memo|efficient)\b/i.test(added)) {
    type = "perf";
    reasons.push("Changes improve performance");
    confidence = "high";
  }

  if (!type && /\b(refactor|restructure|reorganize|simplify|extract|rename|move|decouple)\b/i.test(added)) {
    type = "refactor";
    reasons.push("Changes restructure code");
    confidence = "medium";
  }

  if (!type && files.some(isStyleFile) && !/\b(function|class|const|let|var|import|export)\b/i.test(added)) {
    type = "style";
    reasons.push("Changes appear to be formatting/style only");
    confidence = "medium";
  }

  if (!type && files.some(isBuildFile)) {
    type = "build";
    reasons.push("Changes affect build system or dependencies");
    confidence = "high";
  }

  if (!type && files.some(isCiFile)) {
    type = "ci";
    reasons.push("Changes to CI/CD configuration");
    confidence = "high";
  }

  if (!type) {
    type = "chore";
    reasons.push("General maintenance changes");
    confidence = "low";
  }

  const isBreaking = detectBreaking(diff);
  if (isBreaking) reasons.push("Possible breaking change detected");

  return {
    type,
    scope: detectScope(files),
    isBreaking,
    confidence,
    ticketId: extractTicket(branch),
    reasons,
  };
}
