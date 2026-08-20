# vision-bridge

为无视觉能力的编码模型代理图片理解。

## 解决什么问题

在 Claude Code / Codex 等编码 CLI 里使用不带视觉的编码模型（或视觉很弱的便宜模型）时，粘贴的图片模型"看不见"。vision-bridge 在本地起一个代理，把请求里的图片先交给配置的视觉模型识别成文字描述，再转发给编码模型。

## 快速开始

```bash
npx vision-bridge init     # TUI 配置视觉模型
npx vision-bridge start    # 启动本地代理（127.0.0.1:8787）
```

接入 Claude Code：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_API_KEY=你的编码模型密钥   # 代理原样透传
claude
```

接入 Codex（`~/.codex/config.toml` 的 model provider 或 `OPENAI_BASE_URL`）同理。

## 支持的视觉模型

- OpenAI 兼容协议（GLM-4V / Qwen-VL / SiliconFlow / OpenRouter / Ollama 等）：`type: "openai"`
- Anthropic 原生协议：`type: "anthropic"`

## 配置

`~/.config/vision-bridge/config.json`（详见 [docs/design.md](docs/design.md)）。

## 设计文档

- [docs/design.md](docs/design.md) - 架构设计与测试方案
