---
allowed-tools: Bash(git:*), Bash(commit-flow:*), Bash(npx:*), Read, Grep
description: 智能 Commit：分类器模板 + 详细 why/impact，直接提交
argument-hint: "[可选说明]"
---

用户补充：$ARGUMENTS

## 目标

对当前仓库做一次 **Commit**（不 push）。消息必须含详细描述（为什么 / 影响），不是只有一行 title。

## 步骤

1. **上下文**（并行）：
   - `git status`
   - `git diff --cached --stat` 与 `git diff --cached`
   - `git diff --stat`（未暂存仅作提示，默认不提交除非用户要求）
   - `git log --oneline -10`
   - `git branch --show-current`
   - 若已安装 CLI：`commit-flow classify --json`（可加 `--auto-stage` 若用户要提交全部改动）

2. **敏感文件**：若含 `.env`、`credentials*`、`*.pem`、密钥类路径 → **停止**，列出文件并请用户处理。勿 commit。

3. **消息（方案 C）**：
   - 用分类器结果定 `type` / `scope` / breaking / Summary 骨架
   - **你必须补全**：
     - 祈使语气 title（≤72 字）
     - **Why**：为什么改
     - **改动要点** bullet
     - **Impact**：影响、风险、迁移注意
   - 格式：

```
<type>(<scope>): <title>

<why 与要点>

Summary:
- Files: …
- …

Impact:
- …

Co-authored-by: Claude <noreply@anthropic.com>
```

4. **无暂存**：询问是否 `git add` 哪些文件；不要静默 add 无关文件。

5. **执行**（无需再确认）：
   ```bash
   git commit -m "$(cat <<'EOF'
   <完整 message>
   EOF
   )"
   ```
   然后 `git log -1 --stat`。

6. 若 hook 失败：展示错误，不要强行 `--no-verify`（除非用户明确要求）。
