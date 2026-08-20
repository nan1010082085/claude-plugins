---
description: 配置视觉模型（vision-relay init）
---
用户请求：$ARGUMENTS

请按以下步骤帮用户配置 vision-relay 的视觉模型：

1. 先检查是否已有配置：
   ```bash
   vision-relay doctor
   ```
   如果配置完整且用户只是要换模型，先备份再继续。

2. 运行配置向导：
   ```bash
   vision-relay init
   ```
   如果命令不存在（插件通过 marketplace 安装，未全局安装），使用：
   ```bash
   npx vision-relay init
   ```

3. 向导会引导选择协议（openai / anthropic）、填写 baseUrl、模型名、API Key、maxTokens，并可立即测试连接。

4. 配置完成后用 `vision-relay test` 验证连通性，再用 `vision-relay doctor` 确认接线状态。

如果用户在 $ARGUMENTS 中指定了具体参数（如"换成 GLM-4V"或"baseUrl 改成 xxx"），可直接编辑 `~/.config/vision-relay/config.json` 后运行 `vision-relay test` 验证。
