# vision-relay 设计与测试方案

> 状态：**v0.3.0 开发完成，粘贴图片直读 image-cache，无需用户另存文件。**
>
> 2026-08-20 从零开发到发布，经历 7 个版本迭代（0.1.0 → 0.2.0）。

## 1. 问题

在 Claude Code / Codex / opencode 等编码 CLI 中使用无视觉能力的编码模型时，用户提供的图片（截图、设计稿、报错图）模型无法理解。

## 2. 架构：中转模式（无常驻进程）

**决策记录：** 早期方案是本地 HTTP 代理（拦截 `/v1/messages` 改写图片块），用户明确否决——只要中转，不要常驻服务。代理模式保留为后续可选增强（见 §9）。

```
用户在 CLI 输入（图片路径 / URL + 可选提示词）
   │
   ├─ Claude Code ──► UserPromptSubmit hook
   │     Claude Code 每次提交 prompt 自动拉起 `vision-relay hook`
   │     hook 扫描 prompt 中的图片路径/URL → 识别 → additionalContext 注入上下文
   │
   ├─ Codex ──► MCP 工具 + /vision 自定义命令
   ├─ opencode ──► MCP 工具 + /vision 自定义命令
   │     agent 看到图片引用时调用 vision_describe 工具，描述作为 tool result 进入上下文
   ▼
vision-relay（一次性进程，零守护）
   读配置 → 读图/下载 → 超限自动压缩 → 调视觉模型 → 返回文字描述
```

### 三条注入通道

| 通道 | 终端 | 机制 | 触发 |
|------|------|------|------|
| hook | Claude Code | `~/.claude/settings.json` UserPromptSubmit → `vision-relay hook` | prompt 文本含图片路径/URL 时自动注入 |
| MCP 工具 | 三家都支持 | `vision-relay mcp`（stdio JSON-RPC）→ `vision_describe` | agent 调用，支持 path/url + question |
| 命令 | Claude Code / Codex / opencode | `/vision <图片> <提示词>` 自定义命令模板 | 用户显式发起，提示词自定义 |

### 粘贴图片的处理（v0.3.0）

Claude Code 粘贴图片以 Image content block（base64）进入 API messages，prompt 文本中是 `[Image #N]` 占位符。

**关键发现（实测 Claude Code 2.1.238）**：粘贴时 Claude Code 已把图片落盘到 `~/.claude/image-cache/<session_id>/N.png`，且 UserPromptSubmit hook stdin 含 `session_id`。两者对上后 hook 可直接读盘识别，用户粘贴即用。

处理优先级：
1. **stdin 含 inline base64（预留）**：`extractInlineImages()` 提取识别
2. **`[Image #N]` -> image-cache 直读（主路径）**：`resolvePastedImage()` 按 `session_id + N` 定位缓存文件；stdin 缺 `session_id` 时兜底取最近更新的 image-cache 目录
3. **缓存缺失**：注入降级提示（让用户改用文件路径 / URL），不再要求"另存为文件"

## 3. 视觉模型调用

两种协议，问答式配置：

- **openai**：`POST {baseUrl}/chat/completions`，messages 含 `image_url`（data URI）。兼容一切 OpenAI 风格端点（不绑定厂商）
- **anthropic**：`POST {baseUrl}/v1/messages`，base64 图片块，`x-api-key` + `anthropic-version` 头

URL 规整：baseUrl 以 `/chat/completions`（或 `/messages`）结尾则原样用；以 `/v1` 结尾则补 `/messages`；否则拼接。maxTokens 默认 4096（描述宁长勿缺）。超时默认 30s。

## 4. 配置

`~/.config/vision-relay/config.json`（XDG，写入 0600；`VISION_RELAY_CONFIG_DIR` 可覆盖用于测试）：

```json
{
  "vision": {
    "type": "openai",
    "baseUrl": "https://your-vision-endpoint/v1",
    "apiKey": "…",
    "model": "your-vision-model",
    "maxTokens": 4096,
    "prompt": "（默认结构化描述：图片类型/核心内容/详细描述/编码助手需关注）",
    "timeoutMs": 30000,
    "targetImageBytes": 5242880,
    "maxImageEdge": 8000,
    "maxImageBytes": 104857600
  },
  "hook": { "enabled": true, "maxImages": 4 }
}
```

`question` 参数（MCP 工具 / 命令传入）优先于默认 prompt。

### 大图自动压缩（不拒绝，先压再送）

真正的瓶颈是视觉 API 自身的限制（Anthropic ~5MB、OpenAI 20MB、多数国产端点 ~10MB，长边像素普遍 ~8000px），一刀切拒绝会把大截图直接挡在门外。策略：

| 配置 | 默认 | 行为 |
|------|------|------|
| `vision.targetImageBytes` | 5MB | 超过则自动压缩（对齐最严格的 API） |
| `vision.maxImageEdge` | 8000px | 长边超限等比缩小（长截图常见超限点），用 IHDR 免解码探测 |
| `vision.maxImageBytes` | 100MB | 硬上限（防 OOM），压缩后仍超才拒绝，报错提示可配置 |

压缩管线（jimp，纯 JS 无原生依赖）：白底合成（防透明区变黑）-> 长边约束 -> JPEG q85；仍超目标则质量阶梯降级（85->60->40->20），最低档仍超则分辨率减半后回升画质重试（下限 128px），尽力而为而非失败。jimp 解不了的格式（svg 等）原样送出由 API 决定。未超限的图片字节级透传，不做任何转码。

### 防"抢跑"设计（避免编码模型不调工具就猜图）

三处文案互相配合，把编码模型的行为约束成"先识别、后回答"：

| 位置 | 约束 |
|------|------|
| MCP 工具描述 | "必须先调用本工具，严禁凭文件名或上下文猜测图片内容" |
| /vision 命令模板 | 明确执行顺序：先调工具（带 question）-> 再回答 -> 不够就换更具体的 question 重试 |
| hook 注入文案 | 成功时标注"已识别，无需再调用 vision_describe"（防双重识别）；失败时提示"可用 vision_describe 重试"（fail-open 到工具通道） |

默认识别 prompt 为结构化输出（图片类型 / 核心内容 / 详细描述 / 编码助手需关注），报错截图要求逐字全文转录含错误码与行号。

## 5. CLI 与斜杠命令

| 命令 | 功能 |
|------|------|
| `vision-relay init` | 问答式 TUI：协议 → baseUrl → 模型 → 密钥 → maxTokens → 立即测试连接 → 保存 → 顺势 setup |
| `vision-relay setup` | 自动接线：检测 claude/codex/opencode，multiselect 选择，写入各终端配置 |
| `vision-relay test` | 发 1x1 测试图到视觉模型，验证连通/鉴权/响应非空 |
| `vision-relay doctor` | 配置完整性 + 三终端接线状态 |
| `vision-relay mcp` | stdio MCP server（被终端拉起，非守护） |
| `vision-relay hook` | Claude Code UserPromptSubmit 处理器（读 stdin JSON） |

### Claude CLI 斜杠命令

| 命令 | 说明 |
|------|------|
| `/vision <图片路径> <问题>` | 识别图片，针对问题返回描述 |
| `/vision-config` | 引导配置视觉模型（支持 npx 兜底） |
| `/vision-doctor` | 诊断配置与接线状态 |

### setup 自动接线明细

| 终端 | 写入 |
|------|------|
| Claude Code | `~/.claude/settings.json` hooks.UserPromptSubmit；`claude mcp add -s user`；`~/.claude/commands/vision*.md` |
| Codex | `~/.codex/config.toml` `[mcp_servers.vision-relay]`；`~/.codex/prompts/vision.md` |
| opencode | `~/.config/opencode/opencode.json` mcp.local；`~/.config/opencode/command/vision.md` |

若全局无 `vision-relay` 命令，自动改用 `npx -y vision-relay`。

## 6. 失败策略

- hook：**永不崩溃**——全局 try/catch 兜底，任何内部错误静默降级返回 null
- hook 单图失败不阻塞——注入失败提示 + 可用工具重试，exit 0
- hook 多图**并行**识别（Promise.allSettled），总耗时 = 最慢一张，不超过 hook 超时
- MCP：返回 `isError: true` 的 tool result，由 agent 决定后续
- MCP 工具名校验：未知工具名返回 JSON-RPC 错误
- 多图（hook）：默认上限 4 张，可配 `hook.maxImages`

## 7. 测试

### 单元测试（47 例，Vitest）

| 模块 | 覆盖 |
|------|------|
| images | 图片引用提取（路径/URL/去重/中文尾部标点/裸文件名存在性过滤）、mediaType 映射、pngDimensions 免解码探测 |
| config | 默认值合并、校验、读写往返、0600、新字段校验 |
| vision | URL 规整（openai/anthropic 各分支）、请求体构造（data URI / base64 / question 覆盖）、响应提取、HTTP 错误/空描述 |
| hook | 正常路径、无图、单图失败、禁用、maxImages 截断、非 JSON 输入、**损坏配置不崩**、**多图并行**、**单图失败隔离** |
| mcp | 工具名校验、tools/list、缺参数 isError、路径不存在 isError |
| prepare | 小图透传一致性、大图压缩变小、长边等比缩小、svg 不阻断、硬上限拒绝文案 |

### 集成冒烟

- 本地假视觉服务（node:http）：并行计时验证（2 张 800ms 图总耗时 0.92s < 串行 1.6s）
- 损坏配置静默 exit 0
- 错误工具名返回 JSON-RPC error

### 真模型回归（mimo-v2.5 / token-plan）

- test openai ✓ / anthropic ✓
- hook 真实截图（Figma 页面 452KB）→ 结构化描述 1400+ 字符 ✓
- MCP openai（图标设计风格）✓ / anthropic（图标配色）✓
- 真端到端：claude -p 无头会话编码模型 glm-5.2 自主调用 vision_describe 工具 ✓

### 安全检查

- `.env.local`（测试凭证）未入 npm 包 ✓
- 配置文件 0600 权限 ✓
- API Key 全链路不出现在日志/输出 ✓

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | 配置 + 视觉客户端（两协议）+ TUI init/test | ✅ 完成 |
| M2 | MCP server + Claude Code hook + 三终端 setup + doctor | ✅ 完成 |
| M3 | 防抢跑文案 + 大图自动压缩 + Claude Code plugin 打包 + 斜杠命令 + 真模型 E2E | ✅ 完成 |
| M4+ | 代理模式（图片块拦截）、描述缓存、多视觉模型路由、Web UI | 按需 |

## 9. 代理模式（预留，未实现）

本地 HTTP 代理拦截 `/v1/messages`、`/v1/chat/completions`，把粘贴的图片内容块替换为描述后转发。覆盖"图片块"场景的唯一手段，作为可选高级模式，默认不启用。
