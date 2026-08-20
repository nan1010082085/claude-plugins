# vision-relay 设计与测试方案

> 状态：v2 中转模式（按用户 2026-08-20 反馈修订：无常驻代理）。版本 0.1.0。

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
   读配置 → 读图/下载 → 调视觉模型 → 返回文字描述
```

### 三条注入通道

| 通道 | 终端 | 机制 | 触发 |
|------|------|------|------|
| hook | Claude Code | `~/.claude/settings.json` UserPromptSubmit → `vision-relay hook` | prompt 文本含图片路径/URL 时自动注入 |
| MCP 工具 | 三家都支持 | `vision-relay mcp`（stdio JSON-RPC）→ `vision_describe` | agent 调用，支持 path/url + question |
| 命令 | Claude Code / Codex / opencode | `/vision <图片> <提示词>` 自定义命令模板 | 用户显式发起，提示词自定义 |

### 边界：粘贴的图片块

Claude Code 粘贴图片以内容块进入消息，hook 只能拿到 prompt 文本、MCP 要求模型先"看见"图片——两者都无法拦截图片块。中转模式覆盖**路径 / URL 引用**（用户把图存成文件或贴链接）。图片块拦截需要代理模式（§9）。

## 3. 视觉模型调用

两种协议，问答式配置：

- **openai**：`POST {baseUrl}/chat/completions`，messages 含 `image_url`（data URI）。兼容 GLM-4V / Qwen-VL / SiliconFlow / OpenRouter / Ollama 等一切 OpenAI 风格端点
- **anthropic**：`POST {baseUrl}/v1/messages`，base64 图片块，`x-api-key` + `anthropic-version` 头

URL 规整：baseUrl 以 `/chat/completions`（或 `/messages`）结尾则原样用；以 `/v1` 结尾则补 `/messages`；否则拼接。maxTokens 默认 4096（描述宁长勿缺）。超时默认 30s。

## 4. 配置

`~/.config/vision-relay/config.json`（XDG，写入 0600；`VISION_RELAY_CONFIG_DIR` 可覆盖用于测试）：

```json
{
  "vision": {
    "type": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "apiKey": "…",
    "model": "glm-4v-plus",
    "maxTokens": 4096,
    "prompt": "（默认：详尽描述；UI 截图转录文字；图表提取数据；报错图完整转录）",
    "timeoutMs": 30000
  },
  "hook": { "enabled": true, "maxImages": 4 }
}
```

`question` 参数（MCP 工具 / 命令传入）优先于默认 prompt。

### 防"抢跑"设计（避免编码模型不调工具就猜图）

三处文案互相配合，把编码模型的行为约束成"先识别、后回答"：

| 位置 | 约束 |
|------|------|
| MCP 工具描述 | "必须先调用本工具，严禁凭文件名或上下文猜测图片内容" |
| /vision 命令模板 | 明确执行顺序：先调工具（带 question）-> 再回答 -> 不够就换更具体的 question 重试 |
| hook 注入文案 | 成功时标注"已识别，无需再调用 vision_describe"（防双重识别）；失败时提示"可用 vision_describe 重试"（fail-open 到工具通道） |

默认识别 prompt 为结构化输出（图片类型 / 核心内容 / 详细描述 / 编码助手需关注），报错截图要求逐字全文转录含错误码与行号。

## 5. CLI

| 命令 | 功能 |
|------|------|
| `vision-relay init` | 问答式 TUI：协议 → baseUrl → 模型 → 密钥 → maxTokens → 立即测试连接 → 保存 → 顺势 setup |
| `vision-relay setup` | 自动接线：检测 claude/codex/opencode，multiselect 选择，写入各终端配置 |
| `vision-relay test` | 发 1x1 测试图到视觉模型，验证连通/鉴权/响应非空 |
| `vision-relay doctor` | 配置完整性 + 三终端接线状态 + vision-relay 命令可解析性 |
| `vision-relay mcp` | stdio MCP server（被终端拉起，非守护） |
| `vision-relay hook` | Claude Code UserPromptSubmit 处理器（读 stdin JSON） |

### setup 自动接线明细

| 终端 | 写入 |
|------|------|
| Claude Code | `~/.claude/settings.json` hooks.UserPromptSubmit；`claude mcp add -s user`；`~/.claude/commands/vision.md` |
| Codex | `~/.codex/config.toml` `[mcp_servers.vision-relay]`；`~/.codex/prompts/vision.md` |
| opencode | `~/.config/opencode/opencode.json` mcp.local；`~/.config/opencode/command/vision.md` |

若全局无 `vision-relay` 命令，自动改用 `npx -y vision-relay mcp`。

## 6. 失败策略

- hook：单图失败不阻塞——注入 `[vision-relay 图片 #N 识别失败: 原因]`，exit 0
- MCP：返回 `isError: true` 的 tool result，由 agent 决定后续
- 多图（hook）：默认上限 4 张，可配 `hook.maxImages`

## 7. 测试方案

### 单元（Vitest，mock fetch）

- 图片引用提取：绝对/相对/~ 路径、http(s) URL、多图、去重、误报过滤（路径必须真实存在）
- mediaType 映射；URL 规整（openaiUrl/anthropicUrl 各分支）
- 请求体构造：openai data URI / anthropic base64 块；question 覆盖默认 prompt
- 响应文本提取：两种协议的嵌套结构
- 配置：默认值合并、校验、读写往返、0600

### 集成 / 冒烟

- 本地假视觉服务（node:http 固定响应）+ 临时配置目录：`vision-relay test` 端到端通过
- MCP：管道喂 initialize/tools/list/tools/call JSON，断言响应

### E2E 手册（docs/e2e.md）

- [ ] `vision-relay init` 全流程（含测试连接）
- [ ] `vision-relay setup --all` 三终端接线，`doctor` 全绿
- [ ] Claude Code：prompt 提到 `./screenshots/error.png` → 自动注入描述
- [ ] 三终端 `/vision <路径> <问题>` 或 agent 主动调 vision_describe
- [ ] 视觉端点不可达时 hook 不阻塞会话

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | 配置 + 视觉客户端（两协议）+ TUI init/test | 本版本 |
| M2 | MCP server + Claude Code hook + 三终端 setup + doctor | 本版本 |
| M3 | E2E 手册验证 + npm 发布 | 进行中 |
| M4+ | 代理模式（图片块拦截）、描述缓存、多视觉模型路由、Web UI | 按需 |

## 9. 代理模式（预留，未实现）

本地 HTTP 代理拦截 `/v1/messages`、`/v1/chat/completions`，把粘贴的图片内容块替换为描述后转发。覆盖"图片块"场景的唯一手段，作为可选高级模式，默认不启用。
