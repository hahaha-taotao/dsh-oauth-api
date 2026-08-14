# dsh-oauth-api

[中文说明](README.zh.md)

Out-of-tree [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for third-party **OAuth login**. It is a community plugin, not an official DeepSeek product and not an upstream PR.

After install, **Settings → OAuth 登录** shows one card per provider. Successful login does **not** change the current default model — pick the provider in the official model picker.

## Providers

| Settings card | Model picker group | Auth | Inference |
|---|---|---|---|
| Grok / xAI | `xai-oauth` | Device code (`auth.x.ai`) | `https://api.x.ai/v1/responses` |
| Codex / ChatGPT | `codex-oauth` | Device code (`auth.openai.com/codex/device`) | `https://chatgpt.com/backend-api/codex` |
| Claude Code | `claude-oauth` | PKCE: open authorize URL, paste `code#state` | `https://api.anthropic.com/v1/messages` |

## Install

```bash
git clone https://github.com/hahaha-taotao/dsh-oauth-api.git
cd dsh-oauth-api
pnpm install
pnpm build
dsh plugin --profile web add .
```

Confirm the Cordis rows:

```bash
dsh --profile web --dump-config
```

You should see `dsh-oauth-host` and `dsh-oauth-client`.

## Login

1. Start the UI: `dsh web`
2. Open **Settings → OAuth 登录**
3. Click **登录** on a provider card
4. Finish the browser step (device code, or paste Claude’s `code#state`)
5. Select the matching group in the model picker (`xai-oauth`, `codex-oauth`, or `claude-oauth`)

Grok tokens need the `api:access` scope. If inference says the scope is missing, log in again.

## Token store

Tokens live only in this plugin’s store:

- `$DSH_HOME/oauth/xai.json`
- `$DSH_HOME/oauth/codex.json`
- `$DSH_HOME/oauth/claude.json`

Default `$DSH_HOME` is `~/.dsh`.

## Develop

```bash
pnpm install
pnpm test
pnpm run typecheck
```

## License

MIT
