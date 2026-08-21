---
description: 先视觉识别图片，再据此回答（vision-relay）
argument-hint: <图片路径或URL> [问题]
---
用户请求：$ARGUMENTS

你是**无视觉能力**的编码助手。必须严格按两段式执行，禁止跳过第 1 段直接猜图或凭文件名编造内容。

## 第 1 段：视觉识别（必须先完成）

从 `$ARGUMENTS` 解析出图片（本地路径或 http(s) URL）与可选问题。

**优先**用 Bash 同步调用（比 MCP 更稳，stdout 即描述）：

```bash
vision-relay describe "<图片>" -q "<用户问题，若无问题可省略 -q>"
```

若全局无 `vision-relay`，改用：

```bash
npx -y vision-relay describe "<图片>" -q "<用户问题>"
```

备选：调用 MCP 工具 `vision_describe`（`path` / `url` + `question`），效果相同。

- 命令失败或提示配置不完整 → 引导用户执行 `/vision-config` 或 `vision-relay init`，**不要编造图片内容**。
- 参数里没有图片路径/URL：提醒用法  
  `/vision ./screenshots/error.png 这个报错怎么修`
- 仅有粘贴图占位 `[Image #N]`、且上下文已有 `[vision-relay 图片 #N]` 注入：可跳过第 1 段，直接用该描述。
- 仅有 `[Image #N]` 且无注入：请用户改用文件路径或 URL 再发 `/vision`。

## 第 2 段：编码回答（仅基于描述）

拿到第 1 段的完整文字描述后：

1. **只依据描述**回答用户问题、定位报错、给出修改建议或改代码。
2. 描述不够用时：用更具体的 `-q` / `question` **再跑一次第 1 段**，然后再答。
3. 回答中不要假装「看到了图」；可简要引用描述中的关键原文（错误码、控件文案等）。
