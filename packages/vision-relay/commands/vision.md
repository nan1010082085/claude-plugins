---
description: 用文件路径/URL/剪贴板识别图片后再回答（勿在对话里附图）
argument-hint: <路径|URL|clipboard|recent|#N> [问题]
---
用户请求：$ARGUMENTS

## 硬限制（必须遵守）

当前编码模型**不能看图**。

- **禁止**在本条或后续消息里粘贴/拖拽/附加图片（Codex 会直接拒；Claude 会 400）。
- **只接受纯文本参数**：本地路径、http(s) URL、`clipboard`、`recent`、`#N`。

正确示例：

```
/vision ./screenshots/error.png 这个报错怎么修
/vision clipboard 屏幕上的错误是什么
/vision recent 这张图里写了什么
/vision "#1" 图片内容（仅 Claude：读 image-cache，勿再附图）
```

## 执行步骤（两段式，缺一不可）

你是无视觉编码助手，**禁止猜图**。

### 1) 解析参数

从 `$ARGUMENTS` 取出：

- **图**：第一个像路径 / URL / `clipboard` / `recent` / `#N` 的 token
- **问题**：其余文本；若为空则用「详细描述这张图，便于改代码」

若用户没给图来源：先问一句要路径，或建议其截图后说 `/vision clipboard …`，**不要**让他把图贴进对话框。

### 2) 视觉识别（二选一，优先 CLI）

```bash
vision-relay describe "<图>" -q "<问题>"
```

若 Bash 不可用，则调用 MCP **`vision_describe`**：

| 情况 | 参数 |
|------|------|
| 本地文件 | `path` = 路径 |
| 网址 | `url` = URL |
| 系统剪贴板有图（推荐截图后用） | `path` = `"clipboard"` 或 `source` = `"clipboard"` |
| 最近一次落盘附件 | `path` = `"recent"` |
| Claude 粘贴缓存 | `path` = `"#1"`（不要把图再贴进对话） |
| 问题 | 务必传 `question` |

### 3) 告知用户 + 编码回答

拿到识别结果后：

1. **先用一两句告诉用户**（不要省略）：例如「vision-relay 已识别完成（来源=clipboard），下面根据描述回答。」
2. 再只根据工具/CLI 返回的**文字描述**回答或改代码。
3. 描述不够 → 换更具体的 `question` 再识别一次。

## Codex 特别说明

桌面端自定义 prompt 可能是 `/prompts:vision`。用法相同：**后面只跟路径/clipboard/recent 和问题，不要附图。**
