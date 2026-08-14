# @dsh-plugin/oauth-claude

Claude Code PKCE login for the dsh OAuth settings page.

Flow (same public Claude Code client `9d1c250a-e61b-44d9-88ed-5944d1962f5e`):

1. Open `https://claude.ai/oauth/authorize` with PKCE
2. Anthropic shows a `code#state` on `console.anthropic.com/oauth/code/callback`
3. Paste that code back into Settings
4. Exchange at `https://console.anthropic.com/v1/oauth/token`

Inference uses `https://api.anthropic.com/v1/messages`. Do not read
`~/.claude` or `~/.claude.json`.

Anthropic documents Claude.ai / Claude Code OAuth as intended for official
Claude apps. If the API rejects the token, re-login.
