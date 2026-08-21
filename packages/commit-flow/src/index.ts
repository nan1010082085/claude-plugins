#!/usr/bin/env node
/**
 * commit-flow CLI：分类与状态 JSON，供 slash command / agent 调用。
 * 不在此自动 push；push 由对话确认后 agent 执行。
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./classify.js";
import {
  addAll,
  currentBranch,
  stagedDiff,
  stagedFiles,
  stagedNumstat,
  statusPorcelain,
  unpushedLog,
} from "./git.js";
import {
  buildCommitMessage,
  draftTitle,
  parseNumstat,
} from "./message.js";
import { findSecretFiles } from "./secrets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 读取包版本。
 */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * 收集分类上下文；可选 auto-stage。
 * @param autoStage - 是否先 git add -A
 */
function gather(autoStage: boolean) {
  if (autoStage) addAll();
  const files = stagedFiles();
  const secrets = findSecretFiles(files);
  if (secrets.length > 0) {
    const err = new Error(
      `Refusing to proceed: secret-like files staged:\n${secrets.map((f) => `  - ${f}`).join("\n")}`,
    );
    throw err;
  }
  const diff = stagedDiff();
  const branch = currentBranch();
  const stats = parseNumstat(stagedNumstat());
  const classification = classify({ files, diff, branch });
  const title = draftTitle(classification, files);
  const template = buildCommitMessage({ classification, title, stats });
  return { files, branch, stats, classification, title, template };
}

const program = new Command();

program
  .name("commit-flow")
  .description("Claude Code 快捷 Commit / Commit & Push / Push 辅助 CLI")
  .version(packageVersion());

program
  .command("classify")
  .description("对暂存变更分类并输出 JSON 模板（不 commit）")
  .option("-a, --auto-stage", "先 git add -A", false)
  .action((opts: { autoStage?: boolean }) => {
    try {
      if (!opts.autoStage && stagedFiles().length === 0) {
        console.error("No staged changes. Stage files or pass --auto-stage.");
        process.exit(1);
      }
      const result = gather(Boolean(opts.autoStage));
      if (result.files.length === 0) {
        console.error("No staged changes after auto-stage.");
        process.exit(1);
      }
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program
  .command("status")
  .description("输出工作区与未推送 commits 摘要 JSON")
  .action(() => {
    try {
      const branch = currentBranch();
      const porcelain = statusPorcelain();
      const staged = stagedFiles();
      const unpushed = unpushedLog();
      console.log(
        JSON.stringify(
          {
            branch,
            porcelain,
            staged,
            hasStaged: staged.length > 0,
            hasChanges: porcelain.length > 0,
            unpushed,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program.parse();
