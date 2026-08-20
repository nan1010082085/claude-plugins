# vision-bridge 设计与测试方案

> 状态：设计定稿，M1 开发中。版本 0.1.0。

## 1. 问题

在 Claude Code / Codex 等编码 CLI 中使用无视觉能力的编码模型时，用户粘贴/上传的图片模型无法理解，上下文丢失或直接报错。

目标：编码模型无需具备视觉能力，图片由配置的视觉模型（OpenAI / Anthropic 两种协议、任意 baseUrl + 模型名）识别成结构化文字描述后注入请求。

## 2. 架构：本地 HTTP 代理（Proxy 模式）

**为什么不是 Hook / MCP：**

- Claude Code 的 hook 无法改写用户消息中的图片内容块
- MCP 工具需要模型"看到图片"才知道调用视觉工具——恰恰是编码模型做不到的

所有主流编码 CLI 都支持自定义 API 端点，代理是最通用、对客户端零侵入的方案：

```
Claude Code / Codex
   │  ANTHROPIC_BASE_URL / OPENAI_BASE_URL = http://127.0.0.1:8787
   ▼
vision-bridge 本地代理
   1. 拦截 /v1/messages (Anthropic) 与 /v1/chat/completions (OpenAI)
   2. 扫描请求体中的图片块（base64 / image URL / 多图）
   3. 命中缓存（内容 sha256）则直接复用描述；否则并行调用视觉模型
   4. 把图片块原地替换为文本描述块（保持消息顺序），可选把原图落盘
   5. 无图请求：字节级原样透传（含流式）
   6. 视觉识别失败：默认 fail-open，原图透传，不阻塞编码会话
   ▼
编码模型上游（Authorization / x-api-key 头默认原样透传）
```

## 3. 数据流细节

### 图片发现

- Anthropic 格式：`messages[].content[]` 中 `type === "image"` 的块，`source.type === "base64"`
- OpenAI 格式：`messages[].content[]` 中 `content[].type === "image_url"`（data URL 或 http URL）
- 同一请求多张图片：并行识别，全部完成后一次性改写转发
- 图片 URL（非 data URL）：先下载再交给视觉模型（视觉模型端点可能无法访问内网/临时 URL）

### 描述注入格式

替换图片块为文本块：

```
[Image #N, vision-bridge 描述 by <vision-model>]
<视觉模型返回的描述>
（原图已保存: ~/.cache/vision-bridge/images/<hash>.png）
```

落盘为可选项（`cache.saveOriginal`），默认开启——编码模型后续可用文件工具主动查看原图路径。

### 流式

- 上游响应 SSE 原样管道转发，不解析不缓冲（非流式同理转发 body）
- 唯一阻塞点是"识别图片"阶段，会推迟首 token；多图并行 + 缓存缓解

### 失败策略 `onVisionError`

| 值 | 行为 |
|---|---|
| `passthrough`（默认） | 原图原样发给上游（万一上游其实支持视觉） |
| `placeholder` | 替换为 `[Image #N: vision model failed: <reason>]` |
| `error` | 向客户端返回 502 |

## 4. 配置

`~/.config/vision-bridge/config.json`（XDG；写密钥时 chmod 600）：

```json
{
  "server": { "host": "127.0.0.1", "port": 8787 },
  "vision": {
    "type": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "apiKey": "…",
    "model": "glm-4v-plus",
    "maxTokens": 4096,
    "prompt": "",
    "timeoutMs": 30000,
    "concurrency": 4
  },
  "upstream": { "baseUrl": "", "apiKey": "" },
  "onVisionError": "passthrough",
  "cache": {
    "enabled": true,
    "dir": "~/.cache/vision-bridge",
    "saveOriginal": true
  },
  "log": { "level": "info", "file": "" }
}
```

- `vision.type`：`openai`（chat/completions + image_url，兼容绝大多数视觉端点）或 `anthropic`（/v1/messages + base64 图片块）
- `vision.prompt`：自定义描述提示词，默认要求"详尽描述图片内容，包括 UI 截图中的文字、布局、颜色，图表中的数据"
- `vision.maxTokens`：默认 4096；视觉描述宁可长不可缺
- `upstream.*`：留空 = 请求头/目标主机原样透传；填写 = 显式指定上游（覆盖模式）

## 5. CLI

| 命令 | 功能 |
|------|------|
| `vision-bridge init` | TUI 向导：协议类型、baseUrl、模型名、密钥（输入回显关闭）、写配置 |
| `vision-bridge start` | 前台启动代理；`--port` 覆盖 |
| `vision-bridge test` | 生成 1 张小测试图（SVG 转 PNG）发给视觉模型，校验连通、鉴权、响应非空 |
| `vision-bridge doctor` | 检查 ANTHROPIC_BASE_URL / OPENAI_BASE_URL / Codex config.toml 是否指向本代理，配置完整性 |
| `vision-bridge config` | TUI 编辑已有配置 |

TUI 用 @clack/prompts（Vue 无成熟终端渲染器；Ink 是 React 专属）。Web UI（Vue）作为 M5+ 可选增强，不在 MVP 范围。

## 6. 代码结构

```
src/
├── index.ts            # CLI 入口（commander）
├── config/
│   ├── schema.ts       # 配置类型 + 默认值 + 校验
│   └── loader.ts       # XDG 路径、读写、0600
├── server/
│   ├── server.ts       # http 服务器、路由分发、透传
│   ├── anthropic.ts    # /v1/messages 图片提取与改写
│   ├── openai.ts       # /v1/chat/completions 图片提取与改写
│   └── forward.ts      # 上游转发（含 SSE 管道）
├── vision/
│   ├── provider.ts     # VisionProvider 接口
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── describe.ts     # 并行调度、超时、缓存
│   └── cache.ts        # sha256 -> 描述
├── tui/
│   ├── init.ts         # init 向导
│   └── test.ts         # 测试连接
└── log.ts              # 日志（脱敏：密钥永不出现在日志）
```

## 7. 测试方案

### 7.1 单元测试（Vitest，mock fetch）

| 模块 | 用例 |
|------|------|
| 图片提取 | Anthropic base64 块 / OpenAI data URL / http URL / 多图混合 / 无图；content 为字符串与数组两种形态 |
| 请求改写 | 图片块替换后消息顺序、其余内容块不变；role/system/tools 不被破坏 |
| Provider | OpenAI 请求体构造（image_url data URI）；Anthropic 请求体构造（base64 source）；认证头；超时中止 |
| 配置 | 默认值填充、非法值报错、XDG 路径解析、密钥文件权限 |
| 缓存 | 相同 hash 命中不重复调用；LRU/TTL 淘汰 |
| 失败策略 | 三种 onVisionError 的改写行为 |

### 7.2 集成测试（本地 node:http 假服务）

1. 假上游 + 假视觉服务各一个端口，启动真实代理
2. 带图请求（两种协议）→ 断言上游收到的 body 不含图片、含描述文本块
3. 无图请求 → 断言上游收到的 body 与客户端发送的**字节级一致**
4. SSE 流式响应 → 断言客户端收到的 chunk 序列与上游发出的一致
5. 假视觉服务 500 → 断言 fail-open（上游收到原图）
6. 第二次相同图片请求 → 断言视觉服务只被调用一次（缓存）

### 7.3 E2E 手册（docs/e2e.md，人工）

- [ ] `vision-bridge test` 打真实配置的视觉模型
- [ ] Claude Code：`ANTHROPIC_BASE_URL` 指向代理 + 无视觉编码模型，粘贴截图，确认模型能描述并回答图片问题
- [ ] Codex：OpenAI 兼容 provider 指向代理，同上
- [ ] 视觉端点断网/密钥错误时，编码会话仍正常（fail-open）
- [ ] `npx vision-bridge@latest --version` 在干净环境可用

## 8. 里程碑

| 阶段 | 内容 | 出口标准 |
|------|------|----------|
| M1 | 骨架 + 配置模块 + 代理纯透传（两种协议） | 集成测试 3、4 通过；Claude Code/Codex 接代理后行为与直连一致 |
| M2 | Anthropic 格式图片提取→视觉描述→改写 + 缓存 | 集成测试 1、2、5、6 通过 |
| M3 | OpenAI 格式同上 + 流式验证 | 全部集成测试通过 |
| M4 | TUI init/test + doctor | E2E 1、2、3 通过；npm publish 0.1.0 |
| M5+ | 原图落盘路径注入、Web 配置 UI（Vue）、多视觉模型路由 | 按需 |

## 9. 边界与风险

- **首 token 延迟**：识别发生在转发前，多图并行 + 缓存 + 超时上限（默认 30s）兜底
- **超大图片**：超过阈值（如 15MB base64）直接按 onVisionError 处理，不堵塞
- **安全**：仅绑定 127.0.0.1；不做请求日志落盘（除非显式开 debug 且脱敏）；配置文件 0600
- **客户端兼容**：只透传不解析无关字段，上游/客户端新增字段天然兼容
- **非标准端点**：某些网关路径前缀不同，`upstream.baseUrl` 覆盖模式解决
