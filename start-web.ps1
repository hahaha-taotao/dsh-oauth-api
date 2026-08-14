$env:NODE_USE_ENV_PROXY = '1'
if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = 'http://127.0.0.1:7890' }
if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = $env:HTTPS_PROXY }
npx --yes @deepseek-ai/dsh web @args
