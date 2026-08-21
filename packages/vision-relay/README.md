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

## 使用（推荐：命令两段式）

在 Claude Code / Codex / opencode 里：

```
/vision ./screenshots/error.png 这个报错是什么原因
```

流程固定为：

1. **视觉**：Bash 跑 `vision-relay describe <图> -q "<问题>"`（或 MCP `vision_describe`）拿到文字  
2. **编码**：模型只根据描述回答 / 改代码，禁止猜图

也可直接在终端预览识别结果：

```bash
vision-relay describe ./screenshots/error.png -q "逐字转录报错"
```

prompt 里出现图片路径/URL 时，Claude Code hook 仍会自动注入描述（与 `/vision` 互补）。

### 粘贴图片

Claude Code 粘贴图会落到 `~/.claude/image-cache/<session_id>/N.png`；hook 按 `session_id` + `[Image #N]` 读盘识别。缓存缺失时请改用文件路径 + `/vision`。

### MCP（Cursor 主通道）

`vision_describe`：`path` / `url` / `image_data` + 可选 `question`。必须先调工具再回答。

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/vision <图片> <问题>` | **先识别再回答**（优先 describe CLI） |
| `/vision-config` | 配置视觉模型 |
| `/vision-doctor` | 检查配置与接线 |

### 支持的协议

**OpenAI / Anthropic**，不绑定厂商——baseUrl + 模型名 + API Key 即可。

## 工作原理

```
/vision ./x.png 问题
  │
  ├─ 1) vision-relay describe  → 视觉模型 → 文字描述（stdout）
  └─ 2) 编码模型只读描述 → 回答 / 改代码

其它通道：
  ├─ hook：prompt 含路径/URL 或 Claude 粘贴 image-cache → 自动注入
  └─ MCP vision_describe：Cursor / 无 shell 时备选
```

无常驻进程，不占端口；每次由终端 / 命令按需拉起。

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
