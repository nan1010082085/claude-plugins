---
description: 检查 vision-relay 配置与接线状态
---
请运行诊断：

```bash
npx vision-relay doctor
```

检查内容：配置文件完整性、检测到的终端、各终端接线状态（hook / MCP / 命令）。

有标记 ! 的项，运行 `/vision-config` 重新配置或 `npx vision-relay setup` 自动接线。
