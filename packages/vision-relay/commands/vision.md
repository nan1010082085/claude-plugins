---
description: 先视觉识别图片，再据此回答（vision-relay）
argument-hint: <图片路径或URL或#N> [问题]
---
用户请求：$ARGUMENTS

你是**无视觉能力**的编码助手。必须严格按两段式执行，禁止跳过第 1 段直接猜图或凭文件名编造内容。

## 重要限制（粘贴图）

若本条消息里**仍带有粘贴的图片二进制**（界面出现图片预览 / `[Image #N]` 且图片已附在消息上），无视觉编码模型会直接 **400 Model only support text input**——hook/命令都无法删掉 API 请求里的 image block。

**正确做法：** 不要在同一条消息里再粘贴图。只用路径发纯文本，例如：
- `/vision ./screenshot.png 看看图片是什么`
- 或先：`vision-relay describe "#1" -q "看看图片是什么"`（读最近一次粘贴缓存），再把 stdout 贴回对话

## 第 1 段：视觉识别（必须先完成）

从 `$ARGUMENTS` 解析图片与可选问题。

**优先** Bash（stdout 即描述）：

```bash
# 文件路径或 URL
vision-relay describe "<图片路径或URL>" -q "<问题>"

# 仅有 [Image #N] 占位、且要用缓存文件时（消息中请勿再次粘贴该图）
vision-relay describe "#N" -q "<问题>"
```

无全局命令时：`npx -y vision-relay describe ...`

备选：MCP `vision_describe`（`path` / `url` / `question`）。

- 失败或配置不完整 → `/vision-config` 或 `vision-relay init`，不要编造图片内容。
- 无路径/URL/`#N`：提醒 `/vision ./error.png 这个报错怎么修`
- 上下文已有 `[vision-relay 图片 #N]` 注入：可跳过第 1 段，直接用该描述。

## 第 2 段：编码回答（仅基于描述）

1. **只依据描述**回答。
2. 不够则换更具体的 `-q` 再跑第 1 段。
3. 不要假装「看到了图」；可引用描述中的关键原文。
