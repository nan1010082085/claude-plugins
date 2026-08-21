---
allowed-tools: Bash(git:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: 仅 Push：展示未推送 commits，确认后再推
argument-hint: ""
---

## 目标

**不创建新 commit**，只将本地已有 commits push 到远程。必须先确认。

## 步骤

1. 收集：
   - `git status -sb`
   - `git branch --show-current`
   - `commit-flow status`（若可用）或 `git log @{u}..HEAD --oneline`
2. 若工作区有未提交改动：提醒用户，仍可只 push 已有 commits。
3. 若没有未推送 commits：说明已与远程同步，结束。
4. **展示将推送的 commits 列表**，询问是否 push。
5. 仅当用户肯定确认后：
   - 有 upstream：`git push`
   - 无：`git push -u origin HEAD`
6. 汇报结果；禁止擅自 force push。
