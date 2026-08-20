# vision-relay

为无视觉能力的编码模型代理图片理解。**中转模式，无常驻进程**：你在 CLI 输入里提到图片路径或 URL，vision-relay 用配置的视觉模型识别，把文字描述注入对话上下文。

## 快速开始

```bash
npx vision-relay init      # 问答式配置视觉模型 + 立即测试连接
npx vision-relay setup     # 自动接线到 Claude Code / Codex / opencode
```

### 作为 Claude Code 插件安装（npm 与 plugin 二选一）

```bash
/plugin marketplace add nan1010082085/claude-plugins
/plugin install vision-relay@claude-plugins
```

插件自带 hook（prompt 提到图片路径自动识别）、`vision_describe` MCP 工具和 `/vision` 命令，装完运行一次 `npx vision-relay init` 配置视觉模型即可。

## 三条注入通道

| 通道 | 终端 | 行为 |
|------|------|------|
| **hook** | Claude Code | prompt 里出现图片路径/URL 时自动识别，描述作为上下文注入（无需手动调用） |
| **MCP 工具** | Claude Code / Codex / opencode | `vision_describe(path \| url, question?)`，agent 按需调用 |
| **/vision 命令** | 三家 | `/vision <图片路径> <你的问题>`，提示词自定义 |

示例（Claude Code，接好之后直接说）：

```
帮我看看 ./screenshots/error.png 这个报错是什么原因
```

hook 自动识别图片 -> 描述进入上下文 -> 编码模型基于描述回答。

## 视觉模型配置

`vision-relay init` 问答式配置，支持两种协议：

- **openai**：一切 OpenAI 兼容端点（GLM-4V / Qwen-VL / SiliconFlow / OpenRouter / Ollama…）
- **anthropic**：Claude 原生协议

配置文件：`~/.config/vision-relay/config.json`（0600 权限）。

**大图不拒绝，自动压缩**：超过 5MB（`targetImageBytes`）或长边 8000px（`maxImageEdge`）的截图自动降分辨率/转 JPEG 再送识别；100MB（`maxImageBytes`）硬上限防 OOM。长截图、Retina 高分屏截图开箱即用。

## 命令

| 命令 | 说明 |
|------|------|
| `init` | 问答式配置 + 测试连接 |
| `setup [--all]` | 自动接线三终端（hook / MCP / 命令模板） |
| `test` | 发测试图验证视觉模型连通 |
| `doctor` | 检查配置与接线状态 |
| `mcp` / `hook` | 内部命令，由终端拉起 |

## 边界

粘贴的**图片块**（而非路径/URL引用）无法被 hook 或 MCP 拦截（hook 只拿到 prompt 文本、MCP 需要模型先看见图片）。图片块拦截需要代理模式，见 [docs/design.md](docs/design.md) §9（预留，未实现）。

## 设计文档

[docs/design.md](docs/design.md)
