---
description: 检查 vision-relay 配置与接线状态
---
请运行诊断：

```bash
vision-relay doctor
```

检查内容：

- 视觉配置是否完整
- Claude / Codex / opencode / Cursor 的 hook、MCP、`/vision` 接线
- **会话包装**（`vision-relay claude`）前置条件：编码上游非本机、settings 无残留本机 BASE_URL

有 `!` 的项：`/vision-config` 或 `vision-relay setup`。  
用法速查：路径/`clipboard`/`recent` 用 `/vision`；Claude 对话贴图用 `vision-relay claude`。
