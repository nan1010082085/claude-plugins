---
name: commit-flow
description: Cursor-like git shortcuts — Commit, Commit & Push, Push, Create Branch, Branch & Commit, Branch Commit & Push, Commit & Create PR. Use for commit、提交、push、开分支、PR、wrap up、ship it; always write detailed Conventional Commits with why/impact.
---

# commit-flow

对齐 Cursor「Commit & Push」下拉的 Claude Code 工作流。

## 命令表

| Cursor | Slash | 确认 |
|--------|-------|------|
| Create Branch | `/create-branch` | 展示分支名后直接创建 |
| Create Branch & Commit | `/branch-commit` | Commit 直接 |
| Create Branch, Commit & Push | `/branch-commit-push` | **Push 需确认** |
| Commit | `/commit` | 直接 |
| Commit & Push | `/commit-push` | **Push 需确认** |
| Commit & Create PR | `/commit-pr` | **Push/PR 需确认**（`gh`） |
| （额外）Push | `/push` | **需确认** |

## 消息质量（强制）

禁止只交一行 title。必须含 Why、要点、Impact、Summary。  
优先：`commit-flow classify --json` / `commit-flow suggest-branch`。

## 安全

- 疑似密钥文件 → 停止
- Push / 开 PR 必须用户明确确认
- 默认不用 `--no-verify` / `--force`
