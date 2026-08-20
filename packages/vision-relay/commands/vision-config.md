---
description: 配置视觉模型参数（vision-relay）
---
帮用户配置 vision-relay 的视觉模型。需要配置的参数：

| 参数 | 说明 |
|------|------|
| `type` | 协议类型：`openai` 或 `anthropic`（必选，由用户决定） |
| `baseUrl` | 视觉模型 API 地址（如 `https://api.openai.com/v1`） |
| `model` | 模型名称（如 `gpt-4o`、`claude-sonnet-5`） |
| `apiKey` | API 密钥 |

配置方式（二选一）：

1. **交互式向导**（推荐）：
   ```bash
   npx vision-relay init
   ```

2. **直接编辑配置文件** `~/.config/vision-relay/config.json`：
   ```json
   {
     "vision": {
       "type": "openai",
       "baseUrl": "https://your-endpoint/v1",
       "model": "your-model",
       "apiKey": "your-key"
     }
   }
   ```

配置完成后验证：
```bash
npx vision-relay test
npx vision-relay doctor
```
