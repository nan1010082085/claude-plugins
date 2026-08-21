# commit-flow 设计方案

> 状态：**v0.2.0** — 对齐 Cursor Commit & Push 下拉全套 slash  
> 来源：`tools/commit-hook` + Cursor SCM 菜单

## 1. 问题

Cursor 提供 Create Branch / Commit / Commit & Push / Commit & Create PR 等一键流；Claude Code 需用 slash + skill 复现同等工作流，并强制详细 commit body。

## 2. 命令（v0.2）

| Slash | 对齐 Cursor | 确认 |
|-------|-------------|------|
| `/create-branch` | Create Branch | 展示名后直接 |
| `/branch-commit` | Create Branch & Commit | Commit 直接 |
| `/branch-commit-push` | Create Branch, Commit & Push | Push 确认 |
| `/commit` | Commit | 直接 |
| `/commit-push` | Commit & Push | Push 确认 |
| `/commit-pr` | Commit & Create PR | Push/PR 确认（`gh`） |
| `/push` | （补充）仅推送 | Push 确认 |

**不做**：Cursor 底部 UI、MCP tools、amend/stash/sync（可后续）。

## 3. 消息生成（方案 C）

分类器模板（type/scope/Summary）+ 模型补 Why/Impact → Conventional Commits 全文。

## 4. 架构

```
commands/   create-branch, branch-commit, branch-commit-push,
            commit, commit-push, commit-pr, push
skills/     commit-flow
src/        classify, message, branch(suggest), git, secrets, CLI
```

CLI：`classify` · `suggest-branch` · `status`（不擅自 push/pr）。

## 5. 安全

密钥路径拒绝；Push/PR 需确认；禁默认 force / no-verify。

## 6. 安装

```
/plugin install commit-flow@claude-plugins
npm i -g claude-commit-flow   # bin: commit-flow
```

## 7. 测试

单元：classify / message / secrets / branch  
集成：临时 repo stage  
E2E：`docs/e2e.md`
