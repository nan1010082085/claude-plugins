# Claude Plugins

通用 AI CLI 插件集，为 Claude Code、Codex、opencode、Cursor 等编码环境提供可复用的工具。

## 插件

| 插件 | 功能 | 版本 |
|------|------|------|
| [vision-relay](packages/vision-relay) | 为无视觉能力的编码模型中转图片理解（命令优先 `describe` + MCP + hook） | 0.12.12 |
| [commit-flow](packages/commit-flow) | 对齐 Cursor：Branch / Commit / Push / PR（详细 Conventional Commits） | 0.2.1 |

## 安装

### Claude Code 插件市场

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install vision-relay@claude-plugins
/plugin install commit-flow@claude-plugins
```

### npm

```bash
npm install -g vision-relay
vision-relay init
vision-relay setup

npm install -g claude-commit-flow
commit-flow classify --json
```

## 快速使用（vision-relay）

```bash
# 终端直接识别
vision-relay describe ./shot.png -q "这个报错怎么修"

# Claude Code / Codex / opencode 会话内（两段式：先视觉再编码）
/vision ./shot.png 这个报错怎么修
```

## 快速使用（commit-flow）

```
/create-branch
/branch-commit
/branch-commit-push
/commit
/commit-push
/commit-pr
/push
```

设计与 E2E：[`packages/commit-flow/docs/design.md`](packages/commit-flow/docs/design.md) · [`e2e.md`](packages/commit-flow/docs/e2e.md)

## 开发

```bash
git clone https://github.com/nan1010082085/claude-plugins.git
cd claude-plugins
pnpm install
pnpm build
pnpm test
```

## 许可

MIT
