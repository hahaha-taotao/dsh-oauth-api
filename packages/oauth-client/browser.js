window.__ModuleLoader__.load({
  id: '@dsh-plugin/oauth-client',
  factory: (require) => {
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const css = `
.dsh-oauth{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}
.dsh-oauth h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
.dsh-oauth p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.dsh-oauth .card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dsh-oauth .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-oauth .badge{border-radius:999px;padding:2px 8px;font-size:12px;line-height:18px}
.dsh-oauth .out{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dsh-oauth .pend{background:var(--dsw-alias-state-warn-label);color:var(--dsw-alias-label-primary)}
.dsh-oauth .in{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-oauth .err{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-oauth button{box-sizing:border-box;height:36px;font:inherit;cursor:pointer;border:none;border-radius:18px;padding:0 14px;font-size:14px;line-height:22px}
.dsh-oauth .primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsh-oauth .secondary{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dsh-oauth input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px}
.dsh-oauth code{font-size:16px;user-select:all}
.dsh-oauth a{color:var(--dsw-alias-label-primary)}
.dsh-oauth h3{margin:0;font-size:14px;font-weight:500;line-height:22px}
`
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="@dsh-plugin/oauth-client"]')) {
      const tag = document.createElement('style')
      tag.dataset.pluginCss = '@dsh-plugin/oauth-client'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    async function call(method, path, body) {
      const response = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      if (/(accessToken|refreshToken|deviceCode)/.test(text)) {
        throw new Error('host leaked token fields')
      }
      return JSON.parse(text)
    }

    function ProviderCard({ id, title, hint, pasteCode }) {
      const [snap, setSnap] = React.useState({ state: 'logged_out' })
      const [authCode, setAuthCode] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const prefix = `/dsh-oauth/${id}`

      const refresh = React.useCallback(async () => {
        try {
          setSnap(await call('GET', `${prefix}/status`))
        } catch (error) {
          setSnap({ state: 'error', errorCode: error instanceof Error ? error.message : 'STATUS' })
        }
      }, [prefix])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      React.useEffect(() => {
        if (snap.state !== 'pending') return undefined
        const timer = setInterval(() => {
          void refresh()
        }, 1000)
        return () => clearInterval(timer)
      }, [snap.state, refresh])

      const login = async () => {
        setNotice('')
        try {
          const next = await call('POST', `${prefix}/login`)
          setSnap(next)
          if (next.state === 'pending' && next.verificationUri) {
            window.open(next.verificationUriComplete ?? next.verificationUri, '_blank', 'noopener')
          }
        } catch (error) {
          setSnap({ state: 'error', errorCode: error instanceof Error ? error.message : 'LOGIN' })
        }
      }
      const cancel = async () => {
        try {
          setSnap(await call('POST', `${prefix}/cancel`))
        } catch (error) {
          setSnap({ state: 'error', errorCode: error instanceof Error ? error.message : 'CANCEL' })
        }
      }
      const logout = async () => {
        try {
          setSnap(await call('POST', `${prefix}/logout`))
        } catch (error) {
          setSnap({ state: 'error', errorCode: error instanceof Error ? error.message : 'LOGOUT' })
        }
      }
      const complete = async () => {
        setNotice('')
        try {
          setSnap(await call('POST', `${prefix}/complete`, { code: authCode }))
          setAuthCode('')
        } catch (error) {
          setSnap({ state: 'error', errorCode: error instanceof Error ? error.message : 'COMPLETE' })
        }
      }

      const badgeClass = snap.state === 'logged_in' ? 'in' : snap.state === 'pending' ? 'pend' : snap.state === 'error' ? 'err' : 'out'
      const badgeText = snap.state === 'logged_in' ? '已登录' : snap.state === 'pending' ? '等待授权' : snap.state === 'error' ? '需要重新登录' : '未登录'

      return jsxs('div', {
        className: 'card',
        children: [
          jsxs('div', {
            className: 'row',
            children: [
              jsx('h3', { children: title }),
              jsx('span', { className: `badge ${badgeClass}`, children: badgeText }),
              snap.errorCode ? jsx('span', { children: snap.errorMessage ? `${snap.errorCode}: ${snap.errorMessage}` : snap.errorCode }) : null,
              notice ? jsx('span', { children: notice }) : null,
            ],
          }),
          jsx('p', { children: hint }),
          snap.state === 'pending'
            ? jsxs('div', {
                children: [
                  jsx('p', { children: '在浏览器中打开下面的地址并输入验证码：' }),
                  snap.verificationUri
                    ? jsx('p', {
                        children: jsx('a', {
                          href: snap.verificationUri,
                          target: '_blank',
                          rel: 'noreferrer',
                          children: snap.verificationUri,
                        }),
                      })
                    : null,
                  snap.userCode ? jsxs('p', { children: ['验证码：', jsx('code', { children: snap.userCode })] }) : null,
                  pasteCode
                    ? jsxs('div', {
                        children: [
                          jsx('p', { children: '授权完成后，把页面上的 code#state 粘贴到这里：' }),
                          jsx('input', {
                            value: authCode,
                            autoComplete: 'off',
                            onChange: (event) => setAuthCode(event.target.value),
                          }),
                          jsx('button', { className: 'secondary', type: 'button', onClick: complete, children: '提交授权码' }),
                        ],
                      })
                    : null,
                  jsx('button', {
                    className: 'primary',
                    type: 'button',
                    onClick: () => window.open(snap.verificationUriComplete ?? snap.verificationUri, '_blank', 'noopener'),
                    children: '打开授权页',
                  }),
                ],
              })
            : null,
          jsxs('div', {
            className: 'row',
            children: [
              snap.state === 'pending'
                ? jsx('button', { className: 'secondary', type: 'button', onClick: cancel, children: '取消' })
                : jsx('button', { className: 'primary', type: 'button', onClick: login, children: '登录' }),
              jsx('button', { className: 'secondary', type: 'button', onClick: logout, children: '退出登录' }),
            ],
          }),
        ],
      })
    }

    function OauthSection() {
      return jsxs('section', {
        className: 'dsh-oauth',
        children: [
          jsx('h2', { children: 'OAuth 登录' }),
          jsx('p', { children: '用第三方订阅登录后，在模型选择器里选对应模型。登录不会改当前默认模型。' }),
          jsx(ProviderCard, {
            id: 'xai',
            title: 'Grok / xAI',
            hint: 'SuperGrok 或 X Premium+。若提示缺少 api:access，重新登录。',
          }),
          jsx(ProviderCard, {
            id: 'codex',
            title: 'Codex / ChatGPT',
            hint: 'ChatGPT Plus / Pro / Codex 订阅。打开 auth.openai.com/codex/device 输入验证码。',
          }),
          jsx(ProviderCard, {
            id: 'claude',
            title: 'Claude Code',
            hint: 'Claude Pro / Max。打开授权页后把 code#state 贴回来。',
            pasteCode: true,
          }),
        ],
      })
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-oauth',
        order: 15,
        label: () => 'OAuth 登录',
      }, OauthSection))
    }

    return {
      name: 'dsh-oauth-client',
      inject: ['slots'],
      apply,
    }
  },
})
