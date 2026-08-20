# Claude Plugins

通用 AI CLI 插件集，为 Claude Code、Codex、opencode 等编码环境提供可复用的工具。

## 插件

| 插件 | 功能 | 版本 |
|------|------|------|
| [vision-relay](packages/vision-relay) | 为无视觉能力的编码模型中转图片理解 | [![npm](https://img.shields.io/npm/v/vision-relay)](https://www.npmjs.com/package/vision-relay) |

## 安装

### Claude Code 插件市场

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install vision-relay@claude-plugins
```

### npm

```bash
npm install -g vision-relay
```

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
