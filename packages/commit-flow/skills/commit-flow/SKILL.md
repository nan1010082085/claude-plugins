---
name: commit-flow
description: Intelligent git Commit / Commit & Push / Push with detailed Conventional Commits (classifier template + why/impact). Use when the user says commit、提交、commit and push、push、wrap up、ship it, or wants a commit message with detailed body.
---

# commit-flow

在 Claude Code 对话中完成快捷 Git 工作流（对齐客户端 Commit / Commit & Push / Push）。

## 何时使用

- 用户说 commit / 提交 / smart commit / wrap up
- 用户说 commit and push / 提交并推送
- 用户说 push / 推送（仅推已有 commits）

## 命令对应

| 意图 | 行为 |
|------|------|
| Commit | 分类器模板 + 你补 Why/Impact → **直接** `git commit` |
| Commit & Push | 先 Commit → **确认后** `git push` |
| Push | 展示 `@{u}..HEAD` → **确认后** `git push` |

## 消息质量（强制）

禁止只交一行 title。正文必须包含：

1. **Why** — 为什么改
2. **要点** — 关键文件/行为
3. **Impact** — 影响与风险
4. **Summary** — 文件数与 +/- 行（可来自 classify JSON）

优先跑：`commit-flow classify --json`（或 `npx claude-commit-flow classify --json`）。

## 安全

- 疑似密钥文件 → 停止
- Push 必须用户明确确认
- 默认不用 `--no-verify` / `--force`
