export function renderXaiSettingsPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grok / xAI</title>
  <style>
    :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; background: #f6f6f4; }
    body { max-width: 36rem; margin: 2rem auto; padding: 0 1rem; }
    card { display: block; background: #fff; border: 1px solid #ddd; border-radius: 12px; padding: 1.25rem; }
    .badge { display: inline-block; padding: .15rem .5rem; border-radius: 999px; font-size: .8rem; }
    .out { background: #eee; }
    .in { background: #d8f3dc; }
    .err { background: #ffd6d6; }
    .pend { background: #fff3bf; }
    code { user-select: all; font-size: 1.1rem; }
    button, input { font: inherit; margin-right: .4rem; margin-top: .4rem; }
    .hidden { display: none; }
    label { display: block; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Grok / xAI</h1>
  <card>
    <p>Status: <span id="badge" class="badge out">logged out</span></p>
    <p id="error" class="hidden"></p>
    <div id="pending" class="hidden">
      <p>Open this URL and enter the code:</p>
      <p><a id="uri" href="#" target="_blank" rel="noreferrer"></a></p>
      <p>Code: <code id="code"></code></p>
      <button id="cancel" type="button">Cancel</button>
    </div>
    <p>
      <button id="login" type="button">Login</button>
      <button id="logout" type="button">Logout</button>
    </p>
  </card>
  <script>
    const badge = document.getElementById('badge')
    const error = document.getElementById('error')
    const pending = document.getElementById('pending')
    const uri = document.getElementById('uri')
    const code = document.getElementById('code')
    let timer

    function paint(snap) {
      badge.className = 'badge ' + (snap.state === 'logged_in' ? 'in' : snap.state === 'error' ? 'err' : snap.state === 'pending' ? 'pend' : 'out')
      badge.textContent = snap.state.replace('_', ' ')
      error.classList.toggle('hidden', !snap.errorCode)
      error.textContent = snap.errorCode || ''
      pending.classList.toggle('hidden', snap.state !== 'pending')
      if (snap.verificationUri) {
        uri.href = snap.verificationUri
        uri.textContent = snap.verificationUri
      }
      code.textContent = snap.userCode || ''
    }

    async function read(res) {
      const text = await res.text()
      if (text.includes('accessToken') || text.includes('refreshToken')) throw new Error('token leak')
      return JSON.parse(text)
    }

    async function call(method, path, body) {
      const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      return read(res)
    }

    async function refresh() {
      paint(await call('GET', '/dsh-oauth/xai/status'))
      if (badge.textContent === 'pending') timer = setTimeout(refresh, 1000)
    }

    document.getElementById('login').onclick = async () => {
      clearTimeout(timer)
      paint(await call('POST', '/dsh-oauth/xai/login'))
      timer = setTimeout(refresh, 1000)
    }
    document.getElementById('cancel').onclick = async () => {
      clearTimeout(timer)
      paint(await call('POST', '/dsh-oauth/xai/cancel'))
    }
    document.getElementById('logout').onclick = async () => {
      clearTimeout(timer)
      paint(await call('POST', '/dsh-oauth/xai/logout'))
    }
    refresh()
  </script>
</body>
</html>
`
}
