import {
  OAuthError,
  ProviderId,
  type DeviceCodeChallenge,
  type OAuthProvider,
  type PollResult,
  type TokenSet,
} from '@dsh-plugin/oauth'

export const KIMI_PROVIDER_ID = ProviderId('kimi')

/** Public Kimi Code CLI client (shared with official kimi-code / kimi-cli). */
export const DEFAULT_KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
export const DEFAULT_KIMI_OAUTH_HOST = 'https://auth.kimi.com'
export const DEFAULT_KIMI_DEVICE_URL = 'https://auth.kimi.com/api/oauth/device_authorization'
export const DEFAULT_KIMI_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token'
export const DEFAULT_KIMI_BASE_URL = 'https://api.kimi.com/coding/v1'
export const DEFAULT_KIMI_USER_AGENT = 'KimiCLI/1.5'

type FetchFn = typeof fetch

export interface KimiOAuthConfig {
  readonly clientId?: string
  readonly oauthHost?: string
  readonly deviceUrl?: string
  readonly tokenUrl?: string
  readonly fetch?: FetchFn
}

export function createKimiOAuthProvider(config: KimiOAuthConfig = {}): OAuthProvider {
  const clientId = config.clientId ?? DEFAULT_KIMI_CLIENT_ID
  const host = trimSlash(config.oauthHost ?? DEFAULT_KIMI_OAUTH_HOST)
  const deviceUrl = config.deviceUrl ?? `${host}/api/oauth/device_authorization`
  const tokenUrl = config.tokenUrl ?? `${host}/api/oauth/token`
  const doFetch = config.fetch ?? fetch

  return {
    id: KIMI_PROVIDER_ID,
    displayName: 'Kimi Code',
    startDeviceCode(signal?: AbortSignal) {
      return startDeviceCode({ clientId, deviceUrl, doFetch, ...(signal ? { signal } : {}) })
    },
    pollToken(challenge: DeviceCodeChallenge, signal?: AbortSignal) {
      return pollToken({ clientId, tokenUrl, challenge, doFetch, ...(signal ? { signal } : {}) })
    },
    refresh(refreshToken: string, signal?: AbortSignal) {
      return refreshTokens({ clientId, tokenUrl, refreshToken, doFetch, ...(signal ? { signal } : {}) })
    },
  }
}

async function startDeviceCode(input: {
  clientId: string
  deviceUrl: string
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<DeviceCodeChallenge> {
  const { status, json } = await postForm(
    input.doFetch,
    input.deviceUrl,
    new URLSearchParams({ client_id: input.clientId }),
    input.signal,
  )
  if (status >= 400) {
    const error = optionalString(json, 'error') ?? `HTTP ${status}`
    throw new OAuthError('DEVICE_CODE_FAILED', 'kimi', `Kimi device-code request failed: ${error}`)
  }
  const deviceCode = requiredString(json, 'device_code')
  const userCode = requiredString(json, 'user_code')
  const verificationUri = requiredString(json, 'verification_uri')
  const complete = optionalString(json, 'verification_uri_complete')
  const expiresIn = optionalNumber(json, 'expires_in') ?? 900
  const interval = Math.max(optionalNumber(json, 'interval') ?? 5, 1)
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(complete !== undefined ? { verificationUriComplete: complete } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
    intervalMs: interval * 1000,
  }
}

async function pollToken(input: {
  clientId: string
  tokenUrl: string
  challenge: DeviceCodeChallenge
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<PollResult> {
  const { status, json } = await postForm(
    input.doFetch,
    input.tokenUrl,
    new URLSearchParams({
      client_id: input.clientId,
      device_code: input.challenge.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    input.signal,
  )
  const error = optionalString(json, 'error')
  if (error === 'authorization_pending') return { status: 'pending' }
  if (error === 'slow_down') {
    const interval = optionalNumber(json, 'interval') ?? input.challenge.intervalMs / 1000 + 5
    return { status: 'slow_down', intervalMs: Math.max(1, interval) * 1000 }
  }
  if (error === 'access_denied') return { status: 'denied' }
  if (error === 'expired_token') return { status: 'expired' }
  if (error) {
    throw new OAuthError('TOKEN_ERROR', 'kimi', `Kimi token poll failed: ${error}`)
  }
  if (status >= 400) {
    throw new OAuthError('TOKEN_ERROR', 'kimi', `Kimi token poll HTTP ${status}`)
  }
  return { status: 'approved', tokens: readTokenSet(json) }
}

async function refreshTokens(input: {
  clientId: string
  tokenUrl: string
  refreshToken: string
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<TokenSet> {
  const { status, json } = await postForm(
    input.doFetch,
    input.tokenUrl,
    new URLSearchParams({
      client_id: input.clientId,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    }),
    input.signal,
  )
  const error = optionalString(json, 'error')
  if (error === 'invalid_grant' || status === 400) {
    throw new OAuthError('INVALID_GRANT', 'kimi', 'Kimi refresh token was revoked or expired')
  }
  if (error || status >= 400) {
    throw new OAuthError('REFRESH_FAILED', 'kimi', `Kimi refresh failed: ${error ?? `HTTP ${status}`}`)
  }
  return readTokenSet(json, input.refreshToken)
}

function readTokenSet(json: Record<string, unknown>, fallbackRefresh?: string): TokenSet {
  const accessToken = requiredString(json, 'access_token')
  const refreshToken = optionalString(json, 'refresh_token') ?? fallbackRefresh
  if (!refreshToken) {
    throw new OAuthError('MALFORMED_TOKEN', 'kimi', 'Kimi token response omitted refresh_token')
  }
  const expiresIn = optionalNumber(json, 'expires_in') ?? 900
  const tokenType = optionalString(json, 'token_type') ?? 'Bearer'
  const scope = optionalString(json, 'scope')
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType,
    ...(scope !== undefined ? { scope } : {}),
  }
}

async function postForm(
  doFetch: FetchFn,
  url: string,
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await doFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
    ...(signal ? { signal } : {}),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
    } catch {
      throw new OAuthError(
        'DEVICE_CODE_FAILED',
        'kimi',
        `Kimi returned non-JSON HTTP ${response.status} from ${url}: ${text.slice(0, 120)}`,
      )
    }
  }
  return { status: response.status, json }
}

function requiredString(json: Record<string, unknown>, key: string): string {
  const value = json[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthError('MALFORMED_TOKEN', 'kimi', `Kimi response missing ${key}`)
  }
  return value
}

function optionalString(json: Record<string, unknown>, key: string): string | undefined {
  const value = json[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(json: Record<string, unknown>, key: string): number | undefined {
  const value = json[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
