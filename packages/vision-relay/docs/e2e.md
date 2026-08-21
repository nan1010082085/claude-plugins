# vision-relay E2E 测试记录

> 日期：2026-08-20 | 环境：macOS (Darwin) | Node v24.15.0 | Claude Code (glm-5.2 / volces)
> 视觉模型：mimo-v2.5（token-plan / xiaomimimo，openai + anthropic 双协议）

## 环境验证

- [x] `vision-relay init` 问答式配置 + 测试连接通过
- [x] `vision-relay setup --all` 检测到 Claude Code，接线成功
- [x] `vision-relay doctor` 全绿（配置完整、Claude Code 已接线）
- [x] `vision-relay test` openai 协议通过（"这张测试图是红色的"）
- [x] `vision-relay test` anthropic 协议通过（"这张测试图是红色"）

## Hook 链路

- [x] 模拟 Claude Code stdin JSON 格式，真实截图（Figma 官网 452KB）→ 结构化描述注入（1400+ 字符，页面文案全文转录）
- [x] 无图片 prompt → 静默返回，无副作用
- [x] 损坏配置 → 静默跳过，不阻塞会话
- [x] 多图并行识别（2 张 800ms 假图总耗时 0.92s）
- [x] stdin 含 inline base64 图片（images 字段）→ 直接识别
- [x] stdin 含 data URI 图片（content 字段）→ 直接识别
- [x] stdin 有 inline 图片时优先于路径扫描

- [x] `[Image #N]` + 真实路径 -> 一起识别
- [x] `[Pasted text #N]` 也触发提示
- [x] **粘贴图片直读**：stdin `session_id` + `[Image #1]` -> 读 `~/.claude/image-cache/<session_id>/1.png` 识别注入（2026-08-21 真模型验证，返回完整结构化描述）
- [x] 粘贴图片与路径引用混合 -> 并行识别
- [x] 缓存缺失（session 不存在）-> 降级提示，不再要求另存文件

## MCP 工具链路

- [x] `tools/list` 返回 vision_describe 工具
- [x] `tools/call` + 本地图片 + question → 识别成功（openai 协议）
- [x] `tools/call` + 本地图片 + question → 识别成功（anthropic 协议）
- [x] `tools/call` 缺参数 → isError
- [x] `tools/call` 未知工具名 → JSON-RPC 错误
- [x] 7.7MB 大图（5000x3200）→ 自动压缩后识别成功
- [x] `tools/call` + image_data（base64）→ 识别成功（自动推断 MIME）
- [x] `tools/call` + image_data + media_type → 识别成功

## 真端到端（Claude Code 无头会话）

- [x] `claude -p "用 vision_describe 工具看看 xxx.png" --allowedTools mcp__vision-relay__vision_describe`
  - 编码模型 glm-5.2 自主调用 vision_describe 工具
  - 正确回答："Figma 官网，Cookie 弹窗在右下角黑色圆角区域"

## 斜杠命令

- [x] `/vision` 无参数 → 提醒提供图片路径
- [x] `/vision-config` → 引导运行 vision-relay init
- [x] `/vision-doctor` → 引导运行 vision-relay doctor
- [x] **v0.9.0** `/vision` 模板两段式：优先 `vision-relay describe`，再据描述回答（Claude / Codex / opencode 已 setup 覆盖）

## CLI describe（v0.9.0 真模型）

- [x] `vision-relay describe <图>` → 结构化描述（mimo-v2.5）
- [x] `vision-relay describe <图> -q "..."` → 按问题简答
- [x] 缺参 / 路径不存在 → exit 1
- [x] `vision-relay test` openai 连通 ✓

## 安全

- [x] `.env.local`（测试凭证）未入 npm 包（npm pack 验证）
- [x] 配置文件权限 0600
- [x] API Key 不出现在日志/输出

## Codex 接线

- [x] MCP server 配置 → `~/.codex/config.toml` `[mcp_servers.vision-relay]`
- [x] UserPromptSubmit hook → `~/.codex/hooks.json`
- [x] /vision 命令 → `~/.codex/prompts/vision.md`
- [x] `setupCodex()` 自动添加 hook 配置
- [x] `doctor` 检查 Codex hook 接线状态

## 版本发布

| 版本 | 变更 |
|------|------|
| 0.1.0 | 初始实现：配置 + 视觉客户端 + hook + MCP + TUI |
| 0.1.1 | Claude Code plugin 打包 + 防抢跑文案 + 函数式重构 |
| 0.1.2 | 代码审查修复：hook 并行 / 配置损坏不崩 / MCP 工具名校验 / 图片大小上限 |
| 0.1.3 | 大图自动压缩（替换一刀切限制） |
| 0.1.4 | 新增 /vision-config 斜杠命令 |
| 0.1.5 | 新增 /vision-doctor 斜杠命令 + 重写 README |
| 0.2.1 | Codex 接线：setupCodex() 添加 UserPromptSubmit hook + MCP server + /vision 命令 |
| 0.3.0 | 粘贴图片直读：`[Image #N]` 映射 image-cache/<session_id>/N.png，用户粘贴即用 |
| 0.4.0 | Cursor 接线：setupCursor() 写 ~/.cursor/mcp.json（MCP 通道，无 hook） |
| 0.5.0 | test/doctor 诊断输出增强 |
| 0.9.0 | **命令优先**：`describe` CLI + `/vision` 两段式；删除出口劫持代理；setup 覆盖更新命令模板；npm 发布 |