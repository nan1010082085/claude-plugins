# commit-flow

Claude Code 快捷 **Commit / Commit & Push / Push**：分类器填模板，模型补详细 why/impact；涉及 Push 需确认。

## 安装

### Claude Code 插件市场

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install commit-flow@claude-plugins
```

### npm CLI

```bash
npm install -g claude-commit-flow
commit-flow classify --json
```

## 命令

| Slash | 行为 |
|-------|------|
| `/commit` | 智能 message → **直接** commit |
| `/commit-push` | commit → **确认后** push |
| `/push` | 展示未推送 commits → **确认后** push |

自然语言「提交」「提交并推送」「push」会由 skill 触发同等流程。

## CLI

```bash
commit-flow classify          # 暂存区分类 + 消息模板 JSON
commit-flow classify -a       # 先 git add -A 再分类
commit-flow status            # 分支 / 暂存 / 未推送摘要
```

## 设计

见 [`docs/design.md`](docs/design.md) · E2E：[`docs/e2e.md`](docs/e2e.md)

## License

MIT
