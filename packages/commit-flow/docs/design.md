# commit-flow 设计方案

> 状态：**v0.1.0** — Claude Code slash：`/commit` · `/commit-push` · `/push`  
> 来源：评估自 `tools/commit-hook`（smart-commit），迁入 `claude-plugins` marketplace。

## 1. 问题

Cursor 客户端有 Commit / Commit & Push 快捷流；Claude Code 终端缺少同等工作流。旧仓 `plugin-commit-hook` 仅有 `/smart-commit`，缺 Push 确认流，且不在 `claude-plugins` 集合内。

## 2. 目标（一期）

| 能力 | 行为 |
|------|------|
| `/commit` | 分类器填模板 + 模型补「为什么 / 影响」→ **直接** commit |
| `/commit-push` | 同上 commit → **确认后** push |
| `/push` | 展示未推送 commits → **确认后** push |

**不做（一期）**：Create Branch、Create PR、MCP tools、Cursor 式底部 UI。

## 3. 消息生成（方案 C）

```
分类器（规则）                模型（对话内）
     │                            │
     ├─ type / scope / breaking   ├─ 为什么
     ├─ 文件与行数摘要             ├─ 影响 / 风险
     └─ 标题草案                   └─ 审阅要点
                    ↓
         Conventional Commits 全文
```

模板骨架：

```
<type>(<scope>): <title>

<why / what>

Summary:
- Files: N (+A / -D)
- …

Impact:
- …

<footer>
```

## 4. 架构

```
packages/commit-flow/
├── .claude-plugin/plugin.json
├── commands/          # slash：commit / commit-push / push
├── skills/commit-flow/SKILL.md
├── src/
│   ├── classify.ts    # 纯函数：文件列表 + diff → 分类
│   ├── message.ts     # 模板拼装
│   ├── git.ts         # status / diff / commit / push（封装）
│   ├── secrets.ts     # 敏感文件检测
│   └── index.ts       # CLI
├── docs/design.md
├── docs/e2e.md
└── tests/
```

- **分类器**：TypeScript 纯逻辑，单测不依赖真实 git。
- **CLI**：`commit-flow classify|status|…` 供命令内调用拿 JSON 模板。
- **执行主体**：Claude 按 command/skill 跑 git；CLI 不擅自 push。

## 5. 安全

- 疑似密钥文件（`.env`、`credentials*`、`*.pem` 等）→ 拒绝纳入 commit，提示用户。
- Push 路径必须用户明确确认（是 / yes / 确认）。
- 不记录、不打印任何密钥内容。

## 6. 安装

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install commit-flow@claude-plugins
```

或：`npm i -g commit-flow` 后用 CLI。

## 7. 测试

| 层 | 内容 |
|----|------|
| 单元 | classify、message、secrets |
| 集成 | 临时 git repo：stage → classify JSON |
| E2E | `docs/e2e.md` checklist |

## 8. 与旧仓关系

本包为 marketplace 真相源；`tools/commit-hook` 可后续标 deprecated 并指向本包。
