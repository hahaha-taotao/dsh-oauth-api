# @dsh-plugin/oauth-kimi

Kimi Code device-code login for the dsh OAuth settings page.

Uses the public Kimi Code client `17e5f671-d194-4dfb-9706-5516cb48c098`:

1. `POST https://auth.kimi.com/api/oauth/device_authorization`
2. Open the verification URL and enter the user code
3. Poll `POST https://auth.kimi.com/api/oauth/token`

Inference uses `https://api.kimi.com/coding/v1` with `User-Agent: KimiCLI/1.5`.
Do not read `~/.kimi` or `~/.kimi-code`.
