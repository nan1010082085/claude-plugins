---
allowed-tools: Bash(git:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: Create Branch, Commit & Push — 建分支、提交、确认后推送
argument-hint: "[分支名或说明]"
---

用户补充：$ARGUMENTS

## 目标

对齐 Cursor **Create Branch, Commit & Push**。

## 步骤

### A–B. Branch + Commit

按 `/branch-commit`：创建分支 → 智能 commit（Why/Impact）。可直接执行。

### C. Push（必须确认）

1. 展示：新分支名、`git log -1 --oneline`、将执行 `git push -u origin HEAD`
2. 仅当用户肯定（是 / yes / 确认 / push）后执行：
   ```bash
   git push -u origin HEAD
   ```
3. 禁止 force push。失败贴 stderr。
