# @dsh-plugin/oauth-codex

ChatGPT / Codex device-code OAuth.

Uses the public Codex CLI client `app_EMoamEEZ73f0CkXaXp7hrann` (Hermes
`hermes_cli/auth.py`, Cline, OpenClaw). Login is device-code, not PKCE:

1. `POST https://auth.openai.com/api/accounts/deviceauth/usercode`
2. User opens `https://auth.openai.com/codex/device`
3. Poll `.../deviceauth/token` until an authorization code arrives
4. Exchange at `https://auth.openai.com/oauth/token`

Inference goes to `https://chatgpt.com/backend-api/codex` (Responses), not
`api.openai.com`. Do not read `~/.codex/auth.json`.
