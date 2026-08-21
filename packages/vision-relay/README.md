# vision-relay

**为无视觉能力的编码模型中转图片理解。**  
当前版本：**0.9.2**（[npm](https://www.npmjs.com/package/vision-relay)）

编码模型（DeepSeek、GLM、Qwen 等）无法看图时，vision-relay 先调你配置的视觉模型出文字描述，再交给编码模型回答。支持 Claude Code / Codex / opencode / Cursor。

## 安装

### Claude Code 插件市场

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install vision-relay@claude-plugins
```

### npm 全局

```bash
npm install -g vision-relay
vision-relay init          # 问答式配置视觉模型
vision-relay setup         # 接线 hook / MCP / /vision 命令（覆盖更新模板）
```

### 临时使用

```bash
npx vision-relay init
npx vision-relay setup
```

## 使用（推荐：命令两段式）

```
/vision ./screenshots/error.png 这个报错是什么原因
```

固定流程：

1. **视觉**：Bash 执行 `vision-relay describe <图> -q "<问题>"`（或 MCP `vision_describe`）  
2. **编码**：只根据描述回答 / 改代码，禁止猜图  

终端直接识别：

```bash
vision-relay describe ./screenshots/error.png -q "逐字转录报错"
```

### CLI

| 命令 | 说明 |
|------|------|
| `init` | 配置视觉模型并测连通 |
| `setup` | 接线各终端；**覆盖更新** `/vision` 模板 |
| `describe <图> [-q 问题]` | 同步识别，stdout 输出描述 |
| `test` | 1x1 测试图验证视觉 API |
| `doctor` | 配置与接线诊断 |

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/vision <图片> <问题>` | 先识别再回答（优先 describe） |
| `/vision-config` | 配置视觉模型 |
| `/vision-doctor` | 检查配置与接线 |

### MCP（Cursor 主通道）

`vision_describe`：`path` / `url` / `image_data` + 可选 `question`。必须先调工具再回答。

### 粘贴图片

Claude Code 粘贴图落盘 `~/.claude/image-cache/<session_id>/N.png`；hook 按 `session_id` + `[Image #N]` 读盘识别。缓存缺失时改用路径 + `/vision`。

### 协议

OpenAI / Anthropic，不绑定厂商——`baseUrl` + 模型名 + API Key 即可。

## 工作原理

```
/vision ./x.png 问题
  │
  ├─ 1) vision-relay describe  → 视觉模型 → 文字（stdout）
  └─ 2) 编码模型只读描述 → 回答 / 改代码

其它：
  ├─ hook：路径/URL 或粘贴 image-cache → 自动注入
  └─ MCP vision_describe：Cursor / 无 shell 时
```

无常驻进程、不占端口。

## 图片处理

- 超 5MB 或长边 8000px 自动压缩；100MB 硬上限  
- 多图并行；单图失败不阻塞会话  

## 配置

`~/.config/vision-relay/config.json`（0600）：

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

粘贴依赖 Claude Code image-cache（随会话清理）。路径 / URL 引用不受影响。

## 许可

MIT
