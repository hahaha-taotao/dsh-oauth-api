# dsh-oauth-api

[English](README.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的树外（out-of-tree）**第三方 OAuth 登录**插件。社区项目，不是 DeepSeek 官方产品，也不会向上游提 PR。

安装后，**设置 → OAuth 登录**里每个提供商一张卡。登录**不会**改当前默认模型，需要在官方模型选择器里自己选。

## 提供商

| 设置卡片 | 模型选择器分组 | 登录方式 | 推理接口 |
|---|---|---|---|
| Grok / xAI | `xai-oauth` | 设备码（`auth.x.ai`） | `https://api.x.ai/v1/responses` |
| Codex / ChatGPT | `codex-oauth` | 设备码（`auth.openai.com/codex/device`） | `https://chatgpt.com/backend-api/codex` |
| Claude Code | `claude-oauth` | PKCE：打开授权页，粘贴 `code#state` | `https://api.anthropic.com/v1/messages` |

模型包括 Grok 4.6 / 4.5 / 4.3 / Build、GPT-5.6 Sol / Terra / Luna、Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5，并在厂商支持时提供推理强度。

## 安装

```bash
git clone https://github.com/hahaha-taotao/dsh-oauth-api.git
cd dsh-oauth-api
pnpm install
pnpm build
dsh plugin --profile web add .
```

确认 Cordis 行：

```bash
dsh --profile web --dump-config
```

应能看到 `dsh-oauth-host` 和 `dsh-oauth-client`。

## 登录

1. 启动界面：`dsh web`
2. 打开 **设置 → OAuth 登录**
3. 在对应卡片点 **登录**
4. 完成浏览器步骤（设备码，或把 Claude 的 `code#state` 贴回来）
5. 在模型选择器里选对应分组（`xai-oauth`、`codex-oauth` 或 `claude-oauth`）

Grok 令牌需要 `api:access` 权限。如果推理提示缺少该 scope，重新登录一次。

## 令牌存放

只写本插件自己的文件：

- `$DSH_HOME/oauth/xai.json`
- `$DSH_HOME/oauth/codex.json`
- `$DSH_HOME/oauth/claude.json`

默认 `$DSH_HOME` 是 `~/.dsh`。

## 本插件不会做的事

- 读取 `~/.grok/auth.json`、`~/.codex/auth.json`、`~/.claude`、Hermes、OpenClaw、Pi 的凭据
- 抓取 grok.com
- 对外提供 OpenAI 兼容中转
- 自动改默认模型
- 提供 API Key 兜底（只走 OAuth）

Anthropic 文档写明 Claude.ai / Claude Code 的 OAuth 面向官方应用。如果接口拒绝第三方客户端，请重新登录或换其他提供商。

## 开发

```bash
pnpm install
pnpm test
pnpm run typecheck
```

## 许可证

MIT
