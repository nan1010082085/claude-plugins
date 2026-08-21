---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: Commit & Create PR — 智能提交后确认再开 PR
argument-hint: "[PR 说明]"
---

用户补充：$ARGUMENTS

## 目标

对齐 Cursor **Commit & Create PR**：先智能 Commit，再 **确认后** 用 `gh` 开 PR。

## 步骤

### A. Commit（同 `/commit`，可直接执行）

敏感文件检查 → classify + Why/Impact → `git commit`。

### B. 准备推送与 PR（必须确认）

1. 检查 `gh` 是否可用：`gh auth status`。不可用则说明需安装/登录 GitHub CLI，停止开 PR（commit 已完成可保留）。
2. 若当前分支无 upstream 或有未推送 commits：说明将 `git push -u origin HEAD`，**一并征求确认**。
3. 展示拟用的 PR：
   - title：优先用 commit subject
   - body：摘要 Why / Impact（可用 HEREDOC）
   - base：默认仓库 default branch（`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`）
4. 用户肯定后依次：
   ```bash
   git push -u origin HEAD   # 若尚需推送
   gh pr create --title "<title>" --body "$(cat <<'EOF'
   ## Summary
   …

   ## Test plan
   - [ ] …
   EOF
   )"
   ```
5. 回传 PR URL。不要 `--force`。若用户只要 draft：加 `--draft`。
