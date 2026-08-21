# Claude Plugins 开发规则

本仓库是通用 AI CLI 插件集（Claude Code / Codex 等环境），独立于 dsh-plugins 体系。

## Monorepo 结构

- pnpm workspace，包在 `packages/<plugin>/`
- 根目录 `private: true`，不发布；只有 `packages/` 下的包发布 npm
- TypeScript + Node.js（>= 20），ESM

## 新插件规范

```
packages/<plugin>/
├── src/
│   └── index.ts        # CLI 入口（bin）
├── docs/
│   └── design.md       # 设计文档（先设计后编码）
├── tests/              # Vitest 测试
├── package.json
├── tsconfig.json
└── README.md
```

- 设计先行：新功能先在 `docs/design.md` 补方案，再写代码
- CLI 框架：commander；交互式配置：@clack/prompts（不要用 React/Vue 渲染终端）
- HTTP 一律用原生 fetch，尽量零运行时依赖
- 所有对外端点默认只绑定 127.0.0.1
- 配置文件遵循 XDG：`~/.config/<plugin>/config.json`，写密钥时权限 0600
- 日志禁止输出 API Key 等敏感值

## 发布流程（强制）

1. 修改 `packages/<plugin>/` 代码
2. 更新 `package.json` 的 `version`（semver：patch=修复、minor=新功能、major=破坏性变更）
3. 发布到 npm：`cd packages/<plugin> && npm publish`
4. 同步推送 GitHub
5. 验证：`npx <package> --version` 或安装到目标环境跑通
6. **有代码/文档改动后即 `ima-upload`**（不必等 commit；简述版本与改动）

## 测试要求

每个包必须有三层测试（详见各包 `docs/design.md`）：

- 单元测试（Vitest）：核心逻辑 mock 外部依赖
- 集成测试：本地假服务全链路验证
- E2E 手册：真实环境的验证 checklist，记录在 `docs/e2e.md`
