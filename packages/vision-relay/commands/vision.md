---
description: 先视觉识别图片，再据此回答（vision-relay）— 请勿附带图片附件
argument-hint: <图片路径或URL> [问题]
---
用户请求：$ARGUMENTS

## 硬限制（Claude Code / Codex 都一样）

当前编码模型**不支持图像输入**。

- **Codex**：输入框里粘贴/附加图片 → 客户端直接拦「此模型不支持图像输入」，MCP / 自定义 prompt **根本不会跑到**。
- **Claude Code**：粘贴图会把 Image block 发给模型 → `400 Model only support text input`。

因此：**禁止在同一条消息里附带图片。** 只用纯文本路径：

```
/vision ./screenshots/error.png 这个报错怎么修
```

（Codex 桌面端自定义 prompt 名可能是 `/prompts:vision`，用法相同：后面只跟路径和问题，不要附图。）

也可先在终端识别，再把文字贴回对话：

```bash
vision-relay describe ./screenshots/error.png -q "这个报错怎么修"
```

## 两段式（必须先识别再回答）

你是无视觉编码助手，禁止猜图。

### 第 1 段：视觉识别

```bash
vision-relay describe "<图片路径或URL>" -q "<问题>"
```

备选：MCP `vision_describe`（`path` / `url` + `question`）。

### 第 2 段：编码回答

只根据第 1 段文字描述回答；不够则换更具体的 question 再识别一次。
