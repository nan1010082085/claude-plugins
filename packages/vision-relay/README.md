# vision-relay

**为无视觉能力的编码模型中转图片理解。**

当你的编码模型（DeepSeek、GLM、Qwen 等）无法看图时，vision-relay 用你配置的视觉模型识别图片，把文字描述注入对话，编码模型就能基于描述回答图片相关问题。

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

### Claude CLI 斜杠命令

| 命令 | 说明 |
|------|------|
| `/vision <图片路径> <问题>` | 识别图片，针对问题返回描述 |
| `/vision-config` | 配置视觉模型 |
| `/vision-doctor` | 检查配置与接线状态 |

### 支持的视觉模型

任何 OpenAI 兼容端点（GLM-4V / Qwen-VL / SiliconFlow / OpenRouter / Ollama…）或 Anthropic 原生协议，自定义 baseUrl + 模型名。

## 工作原理

```
你的 prompt（含图片路径）
  │
  ├─ Claude Code hook：自动识别，描述注入上下文（无需手动调用）
  ├─ MCP 工具：vision_describe，编码模型按需调用
  └─ /vision 命令：显式触发
  │
  ▼
vision-relay 调配置的视觉模型识别图片
  │
  ▼
文字描述进入对话上下文，编码模型基于描述回答
```

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

粘贴的**图片块**（直接拖拽到终端）无法被 hook 拦截（hook 只拿到 prompt 文本）。图片块场景需要代理模式（预留，未实现）。通过路径 / URL 引用图片即可正常使用。

## 许可

MIT
