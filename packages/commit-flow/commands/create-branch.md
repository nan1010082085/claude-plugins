---
allowed-tools: Bash(git:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: Create Branch — 建议并创建新分支（对齐 Cursor）
argument-hint: "[分支名或说明]"
---

用户补充：$ARGUMENTS

## 目标

只做 **Create Branch**（不 commit、不 push）。对齐 Cursor「Create Branch」。

## 步骤

1. `git status -sb`、`git branch --show-current`
2. 若有 staged 变更：`commit-flow suggest-branch`（或 `npx claude-commit-flow suggest-branch`）拿 `suggestedBranch`
3. 分支名优先级：
   - `$ARGUMENTS` 若像合法分支名（含 `/` 或 kebab）→ 直接用
   - 否则用 CLI 建议名；再否则根据说明自拟 `type/short-slug`
4. 展示「将创建：`<name>`（基于 `<current>`）」后 **直接执行**：
   ```bash
   git checkout -b "<name>"
   ```
5. 若分支已存在：报错并请用户换名，不要 `-B` 强盖（除非用户明确要求）。
6. 结束时打印 `git status -sb`。
