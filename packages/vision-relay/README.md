# vision-relay

**为无视觉能力的编码模型中转图片理解。**

当你的编码模型（DeepSeek、GLM、Qwen 等）无法看图时，vision-relay 用你配置的视觉模型识别图片，把文字描述注入对话，编码模型就能基于描述回答图片相关问题。支持 Claude Code / Codex / opencode / Cursor。

## 安装

### Claude Code 插件市场（推荐）

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install vision-relay@claude-plugins
```

安装后在 Claude CLI 里用 `/vision-config` 配置视觉模型。

### npm 全局

```bash
npm install -g vision-relay
vision-relay init          # 问答式配置
vision-relay setup         # 自动接线到终端
```

### npm 临时使用（不安装）

```bash
npx vision-relay init
npx vision-relay setup
```

## 使用

配置完成后，直接在 Claude Code 里说：

```
帮我看看 ./screenshots/error.png 这个报错是什么原因
```

prompt 中出现图片路径或 URL 时，vision-relay 自动识别并注入描述，编码模型无需任何改动。

### 粘贴图片

**直接粘贴即可，无需任何额外操作。** 用户在 Claude Code 里粘贴图片时，Claude Code 会把图片落盘到 `~/.claude/image-cache/<session_id>/N.png`；hook 从 stdin 拿到 `session_id`，把 `[Image #N]` 映射到对应缓存文件，直接读取识别并注入描述。

仅在缓存缺失（会话已被清理）时才会提示改用文件路径或 URL。

### MCP 工具参数

`vision_describe` 工具支持三种传图方式（任选其一）：

| 参数 | 说明 |
|------|------|
| `path` | 本地图片路径 |
| `url` | 图片 URL |
| `image_data` | 图片的 base64 编码（配合 `media_type` 使用，预留） |

### Claude CLI 斜杠命令

| 命令 | 说明 |
|------|------|
| `/vision <图片路径> <问题>` | 识别图片，针对问题返回描述 |
| `/vision-config` | 配置视觉模型 |
| `/vision-doctor` | 检查配置与接线状态 |

### 支持的协议

**OpenAI / Anthropic 两种协议**，不绑定厂商——只要提供 baseUrl + 模型名 + API Key 即可。

## 工作原理

```
你的 prompt（含图片路径）
  │
  ├─ Claude Code hook：自动识别，描述注入上下文（无需手动调用）
  ├─ MCP 工具：vision_describe，编码模型按需调用（Codex / opencode / Cursor 的主通道）
  └─ /vision 命令：显式触发（Claude Code / Codex / opencode）
  │
  ▼
vision-relay 调配置的视觉模型识别图片
  │
  ▼
文字描述进入对话上下文，编码模型基于描述回答
```

> **Cursor**：无 UserPromptSubmit hook，仅 MCP 通道（`~/.cursor/mcp.json`）。

无常驻进程，不占端口，每次由终端按需拉起。

## 图片处理

- **大图不拒绝**：超过 5MB 或长边 8000px 的截图自动压缩（降分辨率 / 转 JPEG），100MB 硬上限防 OOM
- **多图并行**：prompt 中有多张图片时并行识别，总耗时 = 最慢一张
- **识别失败不阻塞**：单图失败注入失败提示，不影响其他图片和会话进行

## 配置

`~/.config/vision-relay/config.json`（权限 0600）：

```json
{
  "vision": {
    "type": "openai",
    "baseUrl": "https://your-vision-endpoint/v1",
    "apiKey": "sk-...",
    "model": "your-vision-model",
    "maxTokens": 4096,
    "targetImageBytes": 5242880,
    "maxImageEdge": 8000,
    "maxImageBytes": 104857600
  },
  "hook": { "enabled": true, "maxImages": 4 }
}
```

## 边界

粘贴图片依赖 Claude Code 的 image-cache（`~/.claude/image-cache/<session_id>/N.png`），该目录随会话清理；缓存缺失时降级提示用户提供路径 / URL。通过路径 / URL 引用图片不受影响。

## 许可

MIT
