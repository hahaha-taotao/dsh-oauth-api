import {
  OAuthError,
  ProviderId,
  type DeviceCodeChallenge,
  type OAuthProvider,
  type PollResult,
  type TokenSet,
} from '@dsh-plugin/oauth'

export const CODEX_PROVIDER_ID = ProviderId('codex')

/** Shared Codex CLI / Hermes / Cline public client. */
export const DEFAULT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const DEFAULT_CODEX_ISSUER = 'https://auth.openai.com'
export const DEFAULT_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const DEFAULT_CODEX_VERIFICATION_URI = 'https://auth.openai.com/codex/device'
export const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

type FetchFn = typeof fetch

export interface CodexOAuthConfig {
  readonly clientId?: string
  readonly issuer?: string
  readonly tokenUrl?: string
  readonly fetch?: FetchFn
}

export function createCodexOAuthProvider(config: CodexOAuthConfig = {}): OAuthProvider {
  const clientId = config.clientId ?? DEFAULT_CODEX_CLIENT_ID
  const issuer = trimSlash(config.issuer ?? DEFAULT_CODEX_ISSUER)
  const tokenUrl = config.tokenUrl ?? DEFAULT_CODEX_TOKEN_URL
  const doFetch = config.fetch ?? fetch

  return {
    id: CODEX_PROVIDER_ID,
    displayName: 'Codex / ChatGPT',
    startDeviceCode(signal?: AbortSignal) {
      return startDeviceCode({ clientId, issuer, doFetch, ...(signal ? { signal } : {}) })
    },
    pollToken(challenge: DeviceCodeChallenge, signal?: AbortSignal) {
      return pollToken({ clientId, issuer, tokenUrl, challenge, doFetch, ...(signal ? { signal } : {}) })
    },
    refresh(refreshToken: string, signal?: AbortSignal) {
      return refreshTokens({ clientId, tokenUrl, refreshToken, doFetch, ...(signal ? { signal } : {}) })
    },
  }
}

async function startDeviceCode(input: {
  clientId: string
  issuer: string
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<DeviceCodeChallenge> {
  const json = await postJson(input.doFetch, `${input.issuer}/api/accounts/deviceauth/usercode`, {
    client_id: input.clientId,
  }, input.signal)
  const userCode = requiredString(json, 'user_code')
  const deviceAuthId = requiredString(json, 'device_auth_id')
  const interval = optionalNumber(json, 'interval') ?? 5
  const expiresIn = optionalNumber(json, 'expires_in') ?? 900
  return {
    deviceCode: deviceAuthId,
    userCode,
    verificationUri: DEFAULT_CODEX_VERIFICATION_URI,
    verificationUriComplete: `${DEFAULT_CODEX_VERIFICATION_URI}?user_code=${encodeURIComponent(userCode)}`,
    expiresAt: Date.now() + expiresIn * 1000,
    intervalMs: Math.max(3, interval) * 1000,
  }
}

async function pollToken(input: {
  clientId: string
  issuer: string
  tokenUrl: string
  challenge: DeviceCodeChallenge
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<PollResult> {
  const { status, json } = await postJsonRaw(
    input.doFetch,
    `${input.issuer}/api/accounts/deviceauth/token`,
    {
      device_auth_id: input.challenge.deviceCode,
      user_code: input.challenge.userCode,
    },
    input.signal,
  )
  if (status === 403 || status === 404) return { status: 'pending' }
  if (status === 429) {
    const interval = optionalNumber(json, 'interval') ?? input.challenge.intervalMs / 1000 + 5
    return { status: 'slow_down', intervalMs: Math.max(3, interval) * 1000 }
  }
  if (status >= 400) {
    throw new OAuthError('TOKEN_ERROR', 'codex', `Codex device poll HTTP ${status}`)
  }
  const authorizationCode = optionalString(json, 'authorization_code')
  const codeVerifier = optionalString(json, 'code_verifier')
  if (!authorizationCode || !codeVerifier) return { status: 'pending' }
  const tokens = await exchangeCode({
    clientId: input.clientId,
    tokenUrl: input.tokenUrl,
    authorizationCode,
    codeVerifier,
    doFetch: input.doFetch,
    ...(input.signal ? { signal: input.signal } : {}),
  })
  return { status: 'approved', tokens }
}

async function exchangeCode(input: {
  clientId: string
  tokenUrl: string
  authorizationCode: string
  codeVerifier: string
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.authorizationCode,
    redirect_uri: `${DEFAULT_CODEX_ISSUER}/deviceauth/callback`,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  })
  const { status, json } = await postFormRaw(input.doFetch, input.tokenUrl, body, input.signal)
  if (status >= 400) {
    throw new OAuthError('TOKEN_ERROR', 'codex', `Codex token exchange HTTP ${status}`)
  }
  return readTokenSet(json)
}

async function refreshTokens(input: {
  clientId: string
  tokenUrl: string
  refreshToken: string
  doFetch: FetchFn
  signal?: AbortSignal
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  })
  const { status, json } = await postFormRaw(input.doFetch, input.tokenUrl, body, input.signal)
  const error = optionalString(json, 'error')
  if (error === 'invalid_grant') {
    throw new OAuthError('INVALID_GRANT', 'codex', 'Codex refresh token was revoked or expired')
  }
  if (error || status >= 400) {
    throw new OAuthError('REFRESH_FAILED', 'codex', `Codex refresh failed: ${error ?? `HTTP ${status}`}`)
  }
  return readTokenSet(json, input.refreshToken)
}

function readTokenSet(json: Record<string, unknown>, fallbackRefresh?: string): TokenSet {
  const accessToken = requiredString(json, 'access_token')
  const refreshToken = optionalString(json, 'refresh_token') ?? fallbackRefresh
  if (!refreshToken) {
    throw new OAuthError('MALFORMED_TOKEN', 'codex', 'Codex token response omitted refresh_token')
  }
  const expiresIn = optionalNumber(json, 'expires_in') ?? jwtExpiresIn(accessToken) ?? 3600
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

function jwtExpiresIn(token: string): number | undefined {
  const payload = decodeJwt(token)
  if (!payload || typeof payload.exp !== 'number') return undefined
  return Math.max(60, payload.exp - Math.floor(Date.now() / 1000))
}

export function chatgptAccountId(token: string): string | undefined {
  const payload = decodeJwt(token)
  if (!payload) return undefined
  const auth = payload['https://api.openai.com/auth']
  if (isRecord(auth) && typeof auth.chatgpt_account_id === 'string' && auth.chatgpt_account_id) {
    return auth.chatgpt_account_id
  }
  if (typeof payload.chatgpt_account_id === 'string' && payload.chatgpt_account_id) {
    return payload.chatgpt_account_id
  }
  return undefined
}

function decodeJwt(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload: unknown = JSON.parse(json)
    return isRecord(payload) ? payload : undefined
  } catch {
    return undefined
  }
}

async function postJson(
  doFetch: FetchFn,
  url: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { status, json } = await postJsonRaw(doFetch, url, body, signal)
  if (status >= 400) {
    throw new OAuthError('DEVICE_CODE_FAILED', 'codex', `Codex device-code request HTTP ${status}`)
  }
  return json
}

async function postJsonRaw(
  doFetch: FetchFn,
  url: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  return { status: response.status, json: await readJson(response) }
}

async function postFormRaw(
  doFetch: FetchFn,
  url: string,
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
    ...(signal ? { signal } : {}),
  })
  return { status: response.status, json: await readJson(response) }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function requiredString(json: Record<string, unknown>, key: string): string {
  const value = json[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthError('MALFORMED_TOKEN', 'codex', `Codex response missing ${key}`)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '')
}
