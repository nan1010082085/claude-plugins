---
description: 配置视觉模型（vision-relay）
---
请帮用户配置 vision-relay 的视觉模型：

```bash
npx vision-relay init
```

向导会引导选择协议（OpenAI / Anthropic）、填写 baseUrl、模型名、API Key，并立即测试连接。

配置完成后验证：
```bash
npx vision-relay test
npx vision-relay doctor
```

如果用户指定了具体参数（如 baseUrl 或模型名），可直接编辑 `~/.config/vision-relay/config.json` 后运行 `npx vision-relay test` 验证。
