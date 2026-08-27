# vision-relay

**为无视觉能力的编码模型中转图片理解。**
当前版本：**0.12.13**（[npm](https://www.npmjs.com/package/vision-relay)）

编码模型（DeepSeek、GLM、Qwen 等）看不了图时，先用你配置的**视觉模型**出文字，再交给编码模型改代码。

支持 **Claude Code / Codex / opencode / Cursor**。

---

## 快速开始

```bash
npm install -g vision-relay
vision-relay init          # 配置视觉模型（协议 / URL / Key / 模型名）
vision-relay setup         # 接线（一键确认；写 hook / MCP / 命令）
vision-relay setup --all   # 不询问，配置所有已检测终端
vision-relay doctor        # 检查配置与接线状态
```

Claude Code 也可通过插件市场安装：

```
/plugin marketplace add nan1010082085/claude-plugins
/plugin install vision-relay@claude-plugins
```

然后仍建议跑一次 `vision-relay init` + `setup`。

---

## 用法怎么选

| 场景 | 怎么做 | 终端 |
|------|--------|------|
| **推荐** 有文件路径 | `/vision ./a.png 报错怎么修` | Claude / Codex / opencode |
| 图在系统剪贴板（截图后） | `/vision clipboard 屏幕上写了什么` | 同上；**不要**把图贴进对话框 |
| 最近落盘的附件 | `/vision recent …` | Claude image-cache / Codex attachments |
| Cursor / 无斜杠命令 | 让 Agent 调 MCP `vision_describe` | Cursor 等 |
| Claude **对话里粘贴/拖图** | `vision-relay claude` 再开对话 | **仅 Claude Code CLI** |
| Codex 对话里贴图 | ❌ 客户端常直接拒；用路径 / clipboard | Codex |

**硬限制：** 无包装时，禁止在对话里粘贴/拖图（Claude → 400；Codex → 客户端拦截）。一律用路径 / `clipboard` / `recent` 纯文本参数。

---

## 推荐：`/vision` 两段式

```
/vision ./screenshots/error.png 这个报错是什么原因
/vision clipboard 屏幕上的错误是什么
/vision recent 最近一张图里有什么
/vision "#1" 图片内容          # 仅 Claude：读 image-cache，勿再附图
```

Agent 必须：

1. 跑 `vision-relay describe "<图>" -q "<问题>"`（或 MCP `vision_describe`）
2. **只根据返回文字**回答 / 改代码，禁止猜图

Codex 桌面端自定义 prompt 名可能是 `/prompts:vision`，参数写法相同。

### 终端 CLI

```bash
vision-relay describe ./a.png -q "逐字转录报错"
vision-relay describe clipboard -q "报错全文"
vision-relay describe recent -q "这张图是什么"
vision-relay describe "#1" -q "图片内容"
```

`<图>`：`路径` | `URL` | `clipboard` | `recent` | `#N` / `[Image #N]`

---

## Claude 对话内粘贴：`vision-relay claude`

仅当你必须在 Claude Code **输入框里粘贴/拖图**，且编码上游是纯文本模型：

```bash
vision-relay claude          # 可跟原有参数，如 -c
```

- 用 `--settings` 固定路径文件（`~/.config/vision-relay/session-settings.json`）覆盖 `ANTHROPIC_BASE_URL` → 本机代理
- **不碰** `~/.claude/settings.json`，与 cc-switch 互不干扰
- 固定路径只需信任一次（首次弹确认，后续不再提示）
- 有图：视觉模型识别 → 文字再转发编码上游
- 无图：原样透传编码上游
- Hook / MCP / 记忆等本地能力不受影响
- 退出 Claude 后改写停止

`vision-relay doctor` 里有「会话包装」检查项。

---

## MCP `vision_describe`

| 参数 | 说明 |
|------|------|
| `path` | 本地路径，或 `clipboard` / `recent` / `#1` |
| `url` | 图片 URL |
| `source` | 可选，同 path 别名 |
| `question` | 强烈建议：针对图的问题 |
| `image_data` | base64（一般不推荐） |

必须先调工具再回答。Cursor 主通道。

---

## CLI 一览

| 命令 | 说明 |
|------|------|
| `init` | 配置视觉模型并测连通 |
| `setup` | 接线各终端；**覆盖更新** `/vision` 模板 |
| `describe <图> [-q 问题]` | 同步识别，stdout 输出描述 |
| `claude` | 会话包装启动 Claude（粘贴改写） |
| `test` | 1×1 测试图验证视觉 API |
| `doctor` | 配置、接线、会话包装诊断 |

斜杠命令：`/vision` · `/vision-config` · `/vision-doctor`
别名：`vr`（等同 `vision-relay`）

---

## 工作原理

```
推荐：
  /vision ./x.png 问题
    → describe / MCP → 视觉模型 → 文字
    → 编码模型只读文字 → 回答

可选（仅 Claude CLI 贴图）：
  vision-relay claude
    → 本机改写 Image→文字 → 原编码上游（透传无图请求）
```

视觉与编码是两条线：视觉读 `~/.config/vision-relay/config.json`；编码仍走你原来的上游（如 cc-switch / Ark）。

### 内联图片查找流程（Hook）

当 Claude Code 的 hook 收到 `[Image #N]` 引用时，按以下顺序查找：

1. **image-cache 文件**：`~/.claude/image-cache/<session>/<N>.png`（最快，但 Claude 常清理）
2. **跨 session 缓存**：扫描所有 session 的 image-cache 目录（v0.12.5+）
3. **当前会话 transcript**：从会话 jsonl 中提取 base64 图片数据
4. **全局 transcript 搜索**：扫描所有会话的 transcript（v0.12.5+，支持跨会话引用历史图片）

---

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

协议：`openai` 或 `anthropic`，不绑定厂商。

图片：超约 5MB 或长边 8000px 自动压缩；100MB 硬上限。

---

## 边界

| 能力 | 说明 |
|------|------|
| Codex 对话贴图 | 客户端常直接拒，请用 `/vision` + 路径/clipboard |
| 无包装时 Claude 贴图 | 仍会 400；请用 `/vision` 或 `vision-relay claude` |
| hook | 可辅助路径 / image-cache / transcript；**不能单独**破硬 400 |
| 常驻代理 | 已移除；只有会话包装，退出即停 |

## 更新日志

| 版本 | 变更 |
|------|------|
| **0.12.12** | 启动日志增加视觉模型地址和模型名 |
| 0.12.11 | 去除 proxy stderr 回显 |
| 0.12.10 | 图片描述注入 system 字段，避免 UI 回显改写文本 |
| 0.12.9 | 修复 `vr claude` 代理被绕过：用固定路径 `--settings` 文件覆盖，不碰 settings.json，与 cc-switch 互不干扰 |
| 0.12.5 | 跨会话内联图片搜索：image-cache 和 transcript 均支持全局回退 |
| 0.12.4 | Windows spawn .cmd ENOENT 修复 |
| 0.12.3 | Windows spawn 修复 + `vr` 别名 |
| 0.12.2 | 移除 `--settings` 避免启动信任对话框 |
| 0.12.1 | stdin 已关闭时 readStdin 不阻塞 |
| 0.12.0 | Claude Code 版本检测 + hook matcher 自动修复 |
| 0.11.0 | transcript 兜底读取粘贴图，hook 优先本地命令 |
| 0.10.6 | 用户可见识别状态简报 |
| 0.10.2 | 优化 /vision 与 MCP 图源解析 |
| 0.10.1 | 会话包装粘贴改写（claude --settings） |
| 0.9.0 | 命令优先两段式（describe + /vision） |

## 许可

MIT
