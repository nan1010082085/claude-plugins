---
description: 配置视觉模型参数（vision-relay）
---
帮用户配置 vision-relay 的视觉模型。

步骤：

1. 先检查当前配置状态：
   ```bash
   npx vision-relay doctor
   npx vision-relay test
   ```

2. 根据检查结果，用 AskUserQuestion 工具交互：
   - **已有配置且连通**：问用户"查看当前配置 / 修改配置 / 测试连接"
   - **已有配置但有问题**：指出问题，问用户"修复配置 / 重新创建"
   - **无配置**：问用户"创建新配置"

3. 如果用户要**查看配置**，读取 `~/.config/vision-relay/config.json` 并展示（API Key 脱敏显示，只显示前 4 位和后 4 位）

4. 如果用户要**修改配置**，用 AskUserQuestion 问用户要改哪个参数：

   | 参数 | 说明 |
   |------|------|
   | `type` | 协议类型：`openai` 或 `anthropic` |
   | `baseUrl` | 视觉模型 API 地址 |
   | `model` | 模型名称 |
   | `apiKey` | API 密钥 |

   可以只改部分参数，其余保留。修改后运行 `npx vision-relay test` 验证。

5. 如果用户要**创建新配置**，运行交互式向导：
   ```bash
   npx vision-relay init
   ```

6. 修改完成后用 `npx vision-relay test` 验证连通性。
