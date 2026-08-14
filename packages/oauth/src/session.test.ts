import { describe, expect, it, vi } from 'vitest'
import { OAuthError, ProviderId, type DeviceCodeChallenge, type OAuthProvider, type PollResult, type TokenSet } from './types.js'
import { createOAuthSessionManager } from './session.js'
import { createMemoryTokenStore } from './memory-store.js'

function tokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: 'atk',
    refreshToken: 'rtk',
    expiresAt: Date.now() + 3_600_000,
    tokenType: 'Bearer',
    ...overrides,
  }
}

function fakeProvider(overrides: Partial<OAuthProvider> & { polls?: PollResult[] } = {}): OAuthProvider {
  const polls = overrides.polls ?? [{ status: 'approved', tokens: tokens() }]
  const challenge: DeviceCodeChallenge = {
    deviceCode: 'dev',
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://accounts.x.ai/oauth2/device',
    expiresAt: Date.now() + 60_000,
    intervalMs: 1,
  }
  return {
    id: ProviderId('xai'),
    displayName: 'Grok / xAI',
    startDeviceCode: async () => challenge,
    pollToken: async () => polls.shift() ?? { status: 'pending' },
    refresh: async () => tokens({ accessToken: 'atk-refreshed' }),
    ...overrides,
  }
}

describe('OAuth session manager', () => {
  it('starts login, polls until approved, and hides tokens from snapshots', async () => {
    vi.useFakeTimers()
    const store = createMemoryTokenStore()
    const manager = createOAuthSessionManager({
      providers: [fakeProvider({
        polls: [{ status: 'pending' }, { status: 'approved', tokens: tokens() }],
      })],
      store,
      now: () => Date.now(),
    })

    const started = await manager.startLogin(ProviderId('xai'))
    expect(started.state).toBe('pending')
    expect(started.userCode).toBe('WDJB-MJHT')
    expect(JSON.stringify(started)).not.toContain('atk')
    expect(JSON.stringify(started)).not.toContain('deviceCode')
    expect(JSON.stringify(started)).not.toContain('"dev"')

    const done = manager.waitForLogin(ProviderId('xai'))
    await vi.advanceTimersByTimeAsync(5)
    await expect(done).resolves.toMatchObject({ state: 'logged_in' })
    expect(JSON.stringify(manager.snapshot(ProviderId('xai')))).not.toContain('atk')
    expect(await manager.getAccessToken(ProviderId('xai'))).toBe('atk')
    vi.useRealTimers()
  })

  it('refreshes an expiring access token and quarantines invalid_grant', async () => {
    const store = createMemoryTokenStore()
    await store.write({
      version: 1,
      provider: 'xai',
      accessToken: 'old',
      refreshToken: 'rtk',
      expiresAt: Date.now() + 10_000,
      tokenType: 'Bearer',
      refreshDead: false,
    })
    const manager = createOAuthSessionManager({
      providers: [fakeProvider({
        refresh: async () => {
          throw new OAuthError('INVALID_GRANT', 'xai', 'revoked')
        },
      })],
      store,
      refreshSkewMs: 120_000,
    })

    await expect(manager.getAccessToken(ProviderId('xai'))).rejects.toMatchObject({ code: 'AUTH' })
    expect((await store.read('xai'))).toBeUndefined()
    expect(manager.snapshot(ProviderId('xai'))).toMatchObject({
      state: 'error',
      errorCode: 'INVALID_GRANT',
    })
  })

  it('does not retry forever after refreshDead', async () => {
    const store = createMemoryTokenStore()
    let refreshes = 0
    const manager = createOAuthSessionManager({
      providers: [fakeProvider({
        refresh: async () => {
          refreshes += 1
          throw new OAuthError('INVALID_GRANT', 'xai', 'revoked')
        },
      })],
      store,
    })
    await store.write({
      version: 1,
      provider: 'xai',
      accessToken: 'old',
      refreshToken: 'rtk',
      expiresAt: Date.now() - 1,
      tokenType: 'Bearer',
      refreshDead: true,
    })
    await expect(manager.getAccessToken(ProviderId('xai'))).rejects.toMatchObject({ code: 'AUTH' })
    expect(refreshes).toBe(0)
  })

  it('logout clears the store and returns logged_out', async () => {
    const store = createMemoryTokenStore()
    const manager = createOAuthSessionManager({
      providers: [fakeProvider()],
      store,
    })
    await store.write({
      version: 1,
      provider: 'xai',
      accessToken: 'atk',
      refreshToken: 'rtk',
      expiresAt: Date.now() + 60_000,
      tokenType: 'Bearer',
      refreshDead: false,
    })
    await manager.logout(ProviderId('xai'))
    expect(await store.read('xai')).toBeUndefined()
    expect(manager.snapshot(ProviderId('xai')).state).toBe('logged_out')
  })
})
