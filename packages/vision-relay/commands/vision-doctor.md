---
description: 检查 vision-relay 配置与接线状态
---
请运行诊断：
```bash
vision-relay doctor
```
如果命令不存在，使用：
```bash
npx vision-relay doctor
```

doctor 会检查：
- 配置文件是否存在且完整（~/.config/vision-relay/config.json）
- 检测到哪些终端（claude / codex / opencode）
- 各终端是否已接线（hook / MCP / 命令模板）

如果有任何项标记为 !（未接线），建议用户运行 `/vision-config` 重新配置，或 `vision-relay setup` 自动接线。
