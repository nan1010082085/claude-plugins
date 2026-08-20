# Claude Plugins

通用 AI CLI 插件集，为 Claude Code、Codex 等编码环境提供独立可复用的工具，统一在一个 monorepo 里维护。

> 不属于 DSH 插件体系（dsh-plugins），这里是跨环境的独立轮子仓库。

## 插件清单

| 插件 | npm 包 | 功能 | 版本 |
|------|--------|------|------|
| vision-bridge | `vision-bridge` | 为无视觉能力的编码模型代理图片理解（本地代理） | 0.1.0 (开发中) |

## 结构

```
claude-plugins/
├── packages/
│   └── vision-bridge/      # 图片理解代理
├── package.json            # 根目录，private，不发布
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── CLAUDE.md
```

## 开发

```bash
pnpm install
pnpm build      # 构建所有包
pnpm test       # 运行所有包的测试
```

## 发布流程

1. 修改 `packages/<plugin>/` 代码
2. 更新该包 `package.json` 的 `version`（semver：patch=修复、minor=新功能、major=破坏性变更）
3. 发布：`cd packages/<plugin> && npm publish`
4. 推送 GitHub，提交信息注明版本号
