# @dsh-plugin/oauth-xai

xAI device-code and refresh provider.

Default authorization server is `https://auth.x.ai` (OIDC discovery).
Default `clientId` is the public shared Family A client published in
[OpenClaw issue 84504](https://github.com/openclaw/openclaw/issues/84504):
`b1a00492-073a-47ea-816f-4c329264a828`. Override it with Host config `clientId`.

Default scope is `openid profile email offline_access grok-cli:access api:access`
(Hermes `hermes_cli/auth.py`). `api.x.ai` rejects OAuth tokens that only have
`grok-cli:access` with HTTP 403 `OAuth2 token missing required scope: api:access`.
Re-login after a scope change; refresh of an old grant does not add `api:access`.
