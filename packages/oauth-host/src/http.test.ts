import { describe, expect, it } from 'vitest'
import { ProviderId, createMemoryTokenStore, createOAuthSessionManager, type OAuthProvider, type TokenSet } from '@dsh-plugin/oauth'
import { handleOAuthHttp } from './http.js'

function tokens(): TokenSet {
  return {
    accessToken: 'secret-atk',
    refreshToken: 'secret-rtk',
    expiresAt: Date.now() + 60_000,
    tokenType: 'Bearer',
  }
}

function provider(): OAuthProvider {
  return {
    id: ProviderId('xai'),
    displayName: 'Grok / xAI',
    startDeviceCode: async () => ({
      deviceCode: 'secret-dev',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://accounts.x.ai/oauth2/device',
      expiresAt: Date.now() + 60_000,
      intervalMs: 50_000,
    }),
    pollToken: async () => ({ status: 'pending' }),
    refresh: async () => tokens(),
  }
}

async function invoke(
  manager: ReturnType<typeof createOAuthSessionManager>,
  request: {
    method: string
    url: string
    remoteAddress?: string
    origin?: string
    host?: string
    body?: unknown
  },
  extras?: { credentials?: Map<string, string> },
) {
  const credentials = extras?.credentials ?? new Map<string, string>()
  return handleOAuthHttp({
    manager,
    credentials: {
      async set(ref, value) {
        credentials.set(ref, value)
      },
      async unset(ref) {
        credentials.delete(ref)
      },
    },
    request: {
      method: request.method,
      url: request.url,
      remoteAddress: request.remoteAddress ?? '127.0.0.1',
      headers: {
        ...(request.origin ? { origin: request.origin } : {}),
        ...(request.host ? { host: request.host } : { host: '127.0.0.1:3080' }),
      },
      body: request.body,
    },
  })
}

describe('OAuth host HTTP', () => {
  it('starts login and never returns token fields', async () => {
    const manager = createOAuthSessionManager({
      providers: [provider()],
      store: createMemoryTokenStore(),
    })
    const response = await invoke(manager, {
      method: 'POST',
      url: '/dsh-oauth/xai/login',
      origin: 'http://127.0.0.1:3080',
    })
    expect(response.status).toBe(200)
    const text = JSON.stringify(response.body)
    expect(text).toContain('WDJB-MJHT')
    expect(text).not.toContain('secret-')
    expect(text).not.toContain('accessToken')
    expect(text).not.toContain('refreshToken')
    expect(text).not.toContain('deviceCode')
  })

  it('accepts IPv4-mapped IPv6 loopback', async () => {
    const manager = createOAuthSessionManager({
      providers: [provider()],
      store: createMemoryTokenStore(),
    })
    const response = await invoke(manager, {
      method: 'GET',
      url: '/dsh-oauth/xai/status',
      remoteAddress: '::ffff:127.0.0.1',
      origin: 'http://127.0.0.1:3080',
    })
    expect(response.status).toBe(200)
  })

  it('rejects non-loopback clients', async () => {
    const manager = createOAuthSessionManager({
      providers: [provider()],
      store: createMemoryTokenStore(),
    })
    const response = await invoke(manager, {
      method: 'POST',
      url: '/dsh-oauth/xai/login',
      remoteAddress: '8.8.8.8',
      origin: 'http://example.com',
    })
    expect(response.status).toBe(403)
  })

  it('starts Codex login on the shared /dsh-oauth prefix', async () => {
    const manager = createOAuthSessionManager({
      providers: [
        provider(),
        {
          id: ProviderId('codex'),
          displayName: 'Codex / ChatGPT',
          startDeviceCode: async () => ({
            deviceCode: 'secret-dev',
            userCode: 'V0SZ-CL1Y',
            verificationUri: 'https://auth.openai.com/codex/device',
            expiresAt: Date.now() + 60_000,
            intervalMs: 50_000,
          }),
          pollToken: async () => ({ status: 'pending' }),
          refresh: async () => tokens(),
        },
      ],
      store: createMemoryTokenStore(),
    })
    const response = await invoke(manager, {
      method: 'POST',
      url: '/dsh-oauth/codex/login',
      origin: 'http://127.0.0.1:3080',
    })
    expect(response.status).toBe(200)
    const text = JSON.stringify(response.body)
    expect(text).toContain('V0SZ-CL1Y')
    expect(text).not.toContain('secret-')
  })

  it('logout clears the session', async () => {
    const store = createMemoryTokenStore()
    await store.write({
      version: 1,
      provider: 'xai',
      accessToken: 'secret-atk',
      refreshToken: 'secret-rtk',
      expiresAt: Date.now() + 60_000,
      tokenType: 'Bearer',
      refreshDead: false,
    })
    const manager = createOAuthSessionManager({ providers: [provider()], store })
    await manager.restore()
    const response = await invoke(manager, {
      method: 'POST',
      url: '/dsh-oauth/xai/logout',
      origin: 'http://127.0.0.1:3080',
    })
    expect(response.status).toBe(200)
    expect(await store.read('xai')).toBeUndefined()
    expect(manager.snapshot(ProviderId('xai')).state).toBe('logged_out')
  })
})
