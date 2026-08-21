---
allowed-tools: Bash(git:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: Create Branch & Commit — 新建分支并智能提交
argument-hint: "[分支名或说明]"
---

用户补充：$ARGUMENTS

## 目标

对齐 Cursor **Create Branch & Commit**：先建分支，再按 `/commit` 规则提交（含 Why/Impact）。**不 push**。

## 步骤

### A. Create Branch（可直接执行）

1. 收集 status；`commit-flow suggest-branch` / `$ARGUMENTS` 定分支名
2. 若当前已在目标功能分支且用户未要求新分支，可跳过创建并说明
3. 否则：`git checkout -b "<name>"`（已存在则停止询问）

### B. Commit（同 `/commit`，可直接执行）

1. 敏感文件检测 → 拒绝则停
2. `commit-flow classify --json` + 你补 Why / Impact / 祈使 title
3. 无暂存则与用户确认 stage 范围
4. `git commit` + `git log -1 --stat`

消息格式必须含 Summary + Impact，禁止只有一行 title。
