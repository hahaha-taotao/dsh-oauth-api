import {
  OAuthError,
  ProviderId,
  type DeviceCodeChallenge,
  type OAuthProvider,
  type PollResult,
  type TokenSet,
} from '@dsh-plugin/oauth'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { DEFAULT_XAI_SCOPE } from './scope.js'

export const XAI_PROVIDER_ID = ProviderId('xai')

/** Shared Family A client used by OpenClaw (github.com/openclaw/openclaw/issues/84504). */
export const DEFAULT_XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'

export const DEFAULT_XAI_AUTHORIZATION_SERVER = 'https://auth.x.ai'
export { DEFAULT_XAI_SCOPE, XAI_API_ACCESS_SCOPE, accessTokenGrantsXaiApi, hasXaiApiAccessScope } from './scope.js'

export interface XaiOAuthConfig {
  readonly clientId?: string
  readonly authorizationServer?: string
  readonly deviceCodeUrl?: string
  readonly tokenUrl?: string
  readonly scope?: string
  readonly fetch?: typeof fetch
}

type FetchFn = typeof fetch

export function createXaiOAuthProvider(config: XaiOAuthConfig = {}): OAuthProvider {
  const clientId = config.clientId ?? DEFAULT_XAI_CLIENT_ID
  const authorizationServer = trimSlash(config.authorizationServer ?? DEFAULT_XAI_AUTHORIZATION_SERVER)
  const deviceCodeUrl = config.deviceCodeUrl ?? `${authorizationServer}/oauth2/device/code`
  const tokenUrl = config.tokenUrl ?? `${authorizationServer}/oauth2/token`
  const scope = config.scope ?? DEFAULT_XAI_SCOPE
  const doFetch = config.fetch ?? createProxyAwareFetch()

  return {
    id: XAI_PROVIDER_ID,
    displayName: 'Grok / xAI',
    startDeviceCode(signal?: AbortSignal) {
      return startDeviceCode({
        clientId,
        deviceCodeUrl,
        scope,
        doFetch,
        ...(signal ? { signal } : {}),
      })
    },
    pollToken(challenge: DeviceCodeChallenge, signal?: AbortSignal) {
      return pollToken({
        clientId,
        tokenUrl,
        challenge,
        doFetch,
        ...(signal ? { signal } : {}),
      })
    },
    refresh(refreshToken: string, signal?: AbortSignal) {
      return refreshTokens({
        clientId,
        tokenUrl,
        refreshToken,
        doFetch,
        ...(signal ? { signal } : {}),
      })
    },
  }
}

async function startDeviceCode(input: {
  clientId: string
  deviceCodeUrl: string
  scope: string
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<DeviceCodeChallenge> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    scope: input.scope,
  })
  const json = await postForm(input.doFetch, input.deviceCodeUrl, body, input.signal)
  const deviceCode = requiredString(json, 'device_code')
  const userCode = requiredString(json, 'user_code')
  const verificationUri = requiredString(json, 'verification_uri')
  const expiresIn = requiredNumber(json, 'expires_in')
  const interval = optionalNumber(json, 'interval') ?? 5
  const complete = optionalString(json, 'verification_uri_complete')
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
  const body = new URLSearchParams({
    client_id: input.clientId,
    device_code: input.challenge.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  })
  const { status, json } = await postFormRaw(input.doFetch, input.tokenUrl, body, input.signal)
  const error = optionalString(json, 'error')
  if (error === 'authorization_pending') return { status: 'pending' }
  if (error === 'slow_down') {
    const interval = optionalNumber(json, 'interval') ?? input.challenge.intervalMs / 1000 + 5
    return { status: 'slow_down', intervalMs: interval * 1000 }
  }
  if (error === 'access_denied') return { status: 'denied' }
  if (error === 'expired_token') return { status: 'expired' }
  if (error) {
    throw new OAuthError('TOKEN_ERROR', 'xai', `xAI token poll failed: ${error}`)
  }
  if (status >= 400) {
    throw new OAuthError('TOKEN_ERROR', 'xai', `xAI token poll HTTP ${status}`)
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
  const body = new URLSearchParams({
    client_id: input.clientId,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  })
  const { status, json } = await postFormRaw(input.doFetch, input.tokenUrl, body, input.signal)
  const error = optionalString(json, 'error')
  if (error === 'invalid_grant') {
    throw new OAuthError('INVALID_GRANT', 'xai', 'xAI refresh token was revoked or expired')
  }
  if (error || status >= 400) {
    throw new OAuthError('REFRESH_FAILED', 'xai', `xAI refresh failed: ${error ?? `HTTP ${status}`}`)
  }
  return readTokenSet(json, input.refreshToken)
}

function readTokenSet(json: Record<string, unknown>, fallbackRefresh?: string): TokenSet {
  const accessToken = requiredString(json, 'access_token')
  const refreshToken = optionalString(json, 'refresh_token') ?? fallbackRefresh
  if (!refreshToken) {
    throw new OAuthError('MALFORMED_TOKEN', 'xai', 'xAI token response omitted refresh_token')
  }
  const expiresIn = requiredNumber(json, 'expires_in')
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
): Promise<Record<string, unknown>> {
  const { status, json } = await postFormRaw(doFetch, url, body, signal)
  if (status >= 400) {
    const error = optionalString(json, 'error') ?? `HTTP ${status}`
    throw new OAuthError('DEVICE_CODE_FAILED', 'xai', `xAI device-code request failed: ${error}`)
  }
  return json
}

export function candidateProxyUrls(): string[] {
  const found = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
    'http://127.0.0.1:7890',
    'http://127.0.0.1:7897',
    'http://127.0.0.1:10809',
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  return [...new Set(found)]
}

export function createProxyAwareFetch(): FetchFn {
  const proxies = candidateProxyUrls()
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const errors: string[] = []
    for (const proxy of proxies) {
      try {
        return await dispatchThroughProxy(proxy, input, init)
      } catch (error) {
        const cause = error instanceof Error && 'cause' in error ? String(error.cause) : ''
        errors.push(`${proxy}: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ''}`)
      }
    }
    throw new Error(`fetch failed via proxies ${errors.join(' | ') || '(none)'}`)
  }) as FetchFn
}

async function dispatchThroughProxy(proxy: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const dispatcher = new ProxyAgent({ uri: proxy, connect: { timeout: 4000 } } as never)
  const request: Record<string, unknown> = { dispatcher }
  if (init?.method) request.method = init.method
  if (init?.headers) request.headers = init.headers
  if (init?.body !== undefined && init.body !== null) request.body = init.body
  if (init?.signal) request.signal = init.signal
  return await undiciFetch(String(input), request as never) as unknown as Response
}

async function postFormRaw(
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
      'user-agent': 'dsh-oauth-forward/0.1',
    },
    body,
    ...(signal ? { signal } : {}),
  })
  const text = await response.text()
  try {
    return { status: response.status, json: asObject(JSON.parse(text) as unknown) }
  } catch {
    throw new OAuthError(
      'DEVICE_CODE_FAILED',
      'xai',
      `xAI returned non-JSON HTTP ${response.status} from ${url}: ${text.slice(0, 120)}`,
    )
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new OAuthError('MALFORMED_TOKEN', 'xai', 'xAI returned a non-object JSON body')
}

function requiredString(json: Record<string, unknown>, key: string): string {
  const value = json[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthError('MALFORMED_TOKEN', 'xai', `xAI response missing ${key}`)
  }
  return value
}

function optionalString(json: Record<string, unknown>, key: string): string | undefined {
  const value = json[key]
  return typeof value === 'string' ? value : undefined
}

function requiredNumber(json: Record<string, unknown>, key: string): number {
  const value = json[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OAuthError('MALFORMED_TOKEN', 'xai', `xAI response missing ${key}`)
  }
  return value
}

function optionalNumber(json: Record<string, unknown>, key: string): number | undefined {
  const value = json[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
