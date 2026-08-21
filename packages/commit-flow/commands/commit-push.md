---
allowed-tools: Bash(git:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: Commit 后确认再 Push（详细 commit message）
argument-hint: "[可选说明]"
---

用户补充：$ARGUMENTS

## 目标

先完成与 `/commit` 相同的智能 Commit，再 **等用户确认后** Push。

## 步骤

### A. Commit（同 /commit，可直接执行）

1. 收集 `git status` / staged diff / `commit-flow classify --json`（若可用）
2. 拒绝敏感文件
3. 生成含 Why + Impact 的 Conventional Commits 全文
4. `git commit`（无暂存则先与用户确认 stage）
5. `git log -1 --stat`

### B. Push（必须确认）

1. 展示：
   - 刚提交的 subject
   - `git status -sb`
   - `git log @{u}..HEAD --oneline`（无 upstream 则说明将 `git push -u origin HEAD`）
2. **明确询问**：是否 push？仅当用户回复「是 / yes / 确认 / push」等肯定时继续。
3. 执行：
   - 有 upstream：`git push`
   - 无 upstream：`git push -u origin HEAD`
4. 汇报结果；失败则贴 stderr，不要改 force push。

## 禁止

- 未经确认直接 push
- `--force` / `--force-with-lease`（除非用户本轮明确要求）
