import {
  OAuthError,
  type OAuthProvider,
  type ProviderId,
  type SessionSnapshot,
  type StoredSession,
  type TokenSet,
  type TokenStore,
} from './types.js'
import { STORE_VERSION } from './types.js'

export const DEFAULT_REFRESH_SKEW_MS = 120_000

export interface SessionManagerOptions {
  readonly providers: readonly OAuthProvider[]
  readonly store: TokenStore
  readonly refreshSkewMs?: number
  readonly now?: () => number
  readonly onAccessToken?: (provider: string, accessToken: string | undefined) => Promise<void>
}

export interface OAuthSessionManager {
  restore(): Promise<void>
  startLogin(id: ProviderId): Promise<SessionSnapshot>
  snapshot(id: ProviderId): SessionSnapshot
  waitForLogin(id: ProviderId): Promise<SessionSnapshot>
  cancelLogin(id: ProviderId): void
  logout(id: ProviderId): Promise<void>
  getAccessToken(id: ProviderId): Promise<string>
}

interface PendingLogin {
  readonly verificationUri: string
  readonly verificationUriComplete?: string
  readonly userCode: string
  readonly expiresAt: number
  readonly controller: AbortController
  readonly finished: Promise<SessionSnapshot>
}

export function createOAuthSessionManager(options: SessionManagerOptions): OAuthSessionManager {
  const providers = new Map(options.providers.map((provider) => [provider.id, provider]))
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS
  const now = options.now ?? Date.now
  const pending = new Map<string, PendingLogin>()
  const errors = new Map<string, string>()
  const loggedIn = new Set<string>()

  function provider(id: ProviderId): OAuthProvider {
    const found = providers.get(id)
    if (!found) throw new OAuthError('UNKNOWN_PROVIDER', id, `unknown OAuth provider: ${id}`)
    return found
  }

  function snapshot(id: ProviderId): SessionSnapshot {
    const live = pending.get(id)
    if (live) {
      return {
        state: 'pending',
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        ...(live.verificationUriComplete !== undefined
          ? { verificationUriComplete: live.verificationUriComplete }
          : {}),
        expiresAt: live.expiresAt,
      }
    }
    const errorCode = errors.get(id)
    if (errorCode) return { state: 'error', errorCode }
    if (loggedIn.has(id)) return { state: 'logged_in' }
    return { state: 'logged_out' }
  }

  async function startLogin(id: ProviderId): Promise<SessionSnapshot> {
    cancelLogin(id)
    errors.delete(id)
    const challenge = await provider(id).startDeviceCode()
    const controller = new AbortController()
    const finished = pollUntilDone(id, challenge, controller.signal)
    pending.set(id, {
      verificationUri: challenge.verificationUri,
      ...(challenge.verificationUriComplete !== undefined
        ? { verificationUriComplete: challenge.verificationUriComplete }
        : {}),
      userCode: challenge.userCode,
      expiresAt: challenge.expiresAt,
      controller,
      finished,
    })
    void finished.catch(() => undefined)
    return snapshot(id)
  }

  async function pollUntilDone(
    id: ProviderId,
    challenge: import('./types.ts').DeviceCodeChallenge,
    signal: AbortSignal,
  ): Promise<SessionSnapshot> {
    const oauth = provider(id)
    let intervalMs = challenge.intervalMs
    try {
      while (!signal.aborted) {
        if (now() >= challenge.expiresAt) {
          errors.set(id, 'EXPIRED')
          return snapshotAfterSettle(id)
        }
        const result = await oauth.pollToken(challenge, signal)
        if (result.status === 'pending') {
          await sleep(intervalMs, signal)
          continue
        }
        if (result.status === 'slow_down') {
          intervalMs = result.intervalMs
          await sleep(intervalMs, signal)
          continue
        }
        if (result.status === 'denied') {
          errors.set(id, 'ACCESS_DENIED')
          return snapshotAfterSettle(id)
        }
        if (result.status === 'expired') {
          errors.set(id, 'EXPIRED')
          return snapshotAfterSettle(id)
        }
        await persistTokens(id, result.tokens)
        loggedIn.add(id)
        errors.delete(id)
        return snapshotAfterSettle(id)
      }
      return snapshotAfterSettle(id)
    } catch (error) {
      if (signal.aborted) return snapshotAfterSettle(id)
      errors.set(id, error instanceof OAuthError ? error.code : 'TOKEN_ERROR')
      return snapshotAfterSettle(id)
    }
  }

  function snapshotAfterSettle(id: ProviderId): SessionSnapshot {
    pending.delete(id)
    return snapshot(id)
  }

  function cancelLogin(id: ProviderId): void {
    const live = pending.get(id)
    if (!live) return
    live.controller.abort()
    pending.delete(id)
  }

  async function logout(id: ProviderId): Promise<void> {
    cancelLogin(id)
    errors.delete(id)
    loggedIn.delete(id)
    await options.store.clear(id)
    await options.onAccessToken?.(id, undefined)
  }

  async function getAccessToken(id: ProviderId): Promise<string> {
    const stored = await options.store.read(id)
    if (!stored) {
      throw new OAuthError('AUTH', id, `no ${id} OAuth session; sign in again`)
    }
    if (stored.refreshDead) {
      errors.set(id, 'INVALID_GRANT')
      loggedIn.delete(id)
      throw new OAuthError('AUTH', id, `${id} refresh token is dead; sign in again`)
    }
    if (stored.expiresAt - refreshSkewMs > now()) {
      loggedIn.add(id)
      return stored.accessToken
    }
    try {
      const next = await provider(id).refresh(stored.refreshToken)
      await persistTokens(id, next)
      loggedIn.add(id)
      errors.delete(id)
      return next.accessToken
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'INVALID_GRANT') {
        await options.store.clear(id)
        loggedIn.delete(id)
        errors.set(id, 'INVALID_GRANT')
        await options.onAccessToken?.(id, undefined)
        throw new OAuthError('AUTH', id, `${id} refresh token was revoked; sign in again`)
      }
      throw error
    }
  }

  async function persistTokens(id: ProviderId, tokens: TokenSet): Promise<void> {
    const record: StoredSession = {
      version: STORE_VERSION,
      provider: id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      tokenType: tokens.tokenType,
      refreshDead: false,
      ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
    }
    await options.store.write(record)
    await options.onAccessToken?.(id, tokens.accessToken)
  }

  async function restore(): Promise<void> {
    for (const id of providers.keys()) {
      const stored = await options.store.read(id)
      if (stored && !stored.refreshDead) loggedIn.add(id)
      if (stored?.refreshDead) errors.set(id, 'INVALID_GRANT')
    }
  }

  return {
    restore,
    startLogin,
    snapshot,
    waitForLogin(id) {
      const live = pending.get(id)
      if (!live) return Promise.resolve(snapshot(id))
      return live.finished
    },
    cancelLogin,
    logout,
    getAccessToken,
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
