# @dsh-plugin/oauth-host

Host plugin: token files under `$DSH_HOME/oauth/<provider>.json`, loopback HTTP
under `/dsh-oauth/<provider>`, and LLM adapters:

- `xai-oauth` → `https://api.x.ai/v1`
- `codex-oauth` → `https://chatgpt.com/backend-api/codex`
- `claude-oauth` → `https://api.anthropic.com`
- `kimi-oauth` → `https://api.kimi.com/coding/v1`
