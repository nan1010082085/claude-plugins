# commit-flow

Claude Code 快捷 Git，对齐 Cursor **Commit & Push** 下拉：建分支、Commit、Push、开 PR；消息含详细 why/impact；Push/PR 需确认。

当前版本：**0.2.2**（[npm](https://www.npmjs.com/package/claude-commit-flow)）

## 安装

### Claude Code

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install commit-flow@claude-plugins
```

### npm

```bash
npm install -g claude-commit-flow
commit-flow classify --json
commit-flow suggest-branch
```

## 命令（对齐 Cursor）

| Slash | Cursor | 行为 |
|-------|--------|------|
| `/create-branch` | Create Branch | 建议并创建分支 |
| `/branch-commit` | Create Branch & Commit | 建分支 + 智能 commit |
| `/branch-commit-push` | Create Branch, Commit & Push | 上者 + **确认后** push |
| `/commit` | Commit | 智能 commit（Why/Impact） |
| `/commit-push` | Commit & Push | commit + **确认后** push |
| `/commit-pr` | Commit & Create PR | commit + **确认后** `gh pr create` |
| `/push` | — | 仅 push（确认） |

## CLI

```bash
commit-flow classify [-a]       # 分类 + 消息模板 + suggestedBranch
commit-flow suggest-branch [-a] # 分支名建议
commit-flow status              # 工作区 / 未推送摘要
```

## 设计

[`docs/design.md`](docs/design.md) · [`docs/e2e.md`](docs/e2e.md)

## License

MIT
