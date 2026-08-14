import {
  OAuthError,
  ProviderId,
  type DeviceCodeChallenge,
  type OAuthProvider,
  type PollResult,
  type TokenSet,
} from '@dsh-plugin/oauth'
import { createPkcePair } from './pkce.js'

export const CLAUDE_PROVIDER_ID = ProviderId('claude')

/** Public Claude Code CLI client. */
export const DEFAULT_CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
export const DEFAULT_CLAUDE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
export const DEFAULT_CLAUDE_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
export const DEFAULT_CLAUDE_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
export const DEFAULT_CLAUDE_SCOPE = 'org:create_api_key user:profile user:inference'
export const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com'

type FetchFn = typeof fetch

interface PendingPkce {
  readonly verifier: string
  readonly state: string
  readonly expiresAt: number
  tokens?: TokenSet
  error?: string
}

export interface ClaudeOAuthConfig {
  readonly clientId?: string
  readonly authorizeUrl?: string
  readonly tokenUrl?: string
  readonly redirectUri?: string
  readonly scope?: string
  readonly fetch?: FetchFn
}

export interface ClaudeOAuthProvider extends OAuthProvider {
  completeAuthorization(code: string): Promise<void>
}

export function createClaudeOAuthProvider(config: ClaudeOAuthConfig = {}): ClaudeOAuthProvider {
  const clientId = config.clientId ?? DEFAULT_CLAUDE_CLIENT_ID
  const authorizeUrl = config.authorizeUrl ?? DEFAULT_CLAUDE_AUTHORIZE_URL
  const tokenUrl = config.tokenUrl ?? DEFAULT_CLAUDE_TOKEN_URL
  const redirectUri = config.redirectUri ?? DEFAULT_CLAUDE_REDIRECT_URI
  const scope = config.scope ?? DEFAULT_CLAUDE_SCOPE
  const doFetch = config.fetch ?? fetch
  const pending = new Map<string, PendingPkce>()

  return {
    id: CLAUDE_PROVIDER_ID,
    displayName: 'Claude Code',
    async startDeviceCode() {
      const pkce = createPkcePair()
      const expiresAt = Date.now() + 15 * 60 * 1000
      pending.clear()
      pending.set(pkce.state, { verifier: pkce.verifier, state: pkce.state, expiresAt })
      const url = new URL(authorizeUrl)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', scope)
      url.searchParams.set('code_challenge', pkce.challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', pkce.state)
      return {
        deviceCode: pkce.state,
        userCode: '',
        verificationUri: url.toString(),
        verificationUriComplete: url.toString(),
        expiresAt,
        intervalMs: 1000,
      }
    },
    async pollToken(challenge: DeviceCodeChallenge): Promise<PollResult> {
      const slot = pending.get(challenge.deviceCode)
      if (!slot) return { status: 'expired' }
      if (slot.error) throw new OAuthError('TOKEN_ERROR', 'claude', slot.error)
      if (slot.tokens) {
        pending.delete(challenge.deviceCode)
        return { status: 'approved', tokens: slot.tokens }
      }
      if (Date.now() >= challenge.expiresAt) {
        pending.delete(challenge.deviceCode)
        return { status: 'expired' }
      }
      return { status: 'pending' }
    },
    async completeAuthorization(rawCode: string) {
      const parsed = parsePastedCode(rawCode)
      const slot = pending.get(parsed.state) ?? [...pending.values()][0]
      if (!slot) throw new OAuthError('TOKEN_ERROR', 'claude', 'no Claude login is pending')
      try {
        slot.tokens = await exchangeCode({
          clientId,
          tokenUrl,
          redirectUri,
          code: parsed.code,
          verifier: slot.verifier,
          state: parsed.state || slot.state,
          doFetch,
        })
      } catch (error) {
        slot.error = error instanceof Error ? error.message : String(error)
        throw error
      }
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

export function parsePastedCode(raw: string): { code: string; state: string } {
  const trimmed = raw.trim()
  const hash = trimmed.indexOf('#')
  if (hash === -1) return { code: trimmed, state: '' }
  return { code: trimmed.slice(0, hash).trim(), state: trimmed.slice(hash + 1).trim() }
}

async function exchangeCode(input: {
  clientId: string
  tokenUrl: string
  redirectUri: string
  code: string
  verifier: string
  state: string
  doFetch: FetchFn
}): Promise<TokenSet> {
  const { status, json } = await postJson(input.doFetch, input.tokenUrl, {
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    ...(input.state ? { state: input.state } : {}),
  })
  if (status >= 400) {
    throw new OAuthError('TOKEN_ERROR', 'claude', `Claude token exchange HTTP ${status}`)
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
  const { status, json } = await postJson(
    input.doFetch,
    input.tokenUrl,
    {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
    },
    input.signal,
  )
  const error = typeof json.error === 'string' ? json.error : undefined
  if (error === 'invalid_grant' || status === 400) {
    throw new OAuthError('INVALID_GRANT', 'claude', 'Claude refresh token was revoked or expired')
  }
  if (error || status >= 400) {
    throw new OAuthError('REFRESH_FAILED', 'claude', `Claude refresh failed: ${error ?? `HTTP ${status}`}`)
  }
  return readTokenSet(json, input.refreshToken)
}

function readTokenSet(json: Record<string, unknown>, fallbackRefresh?: string): TokenSet {
  const accessToken = requiredString(json, 'access_token')
  const refreshToken = optionalString(json, 'refresh_token') ?? fallbackRefresh
  if (!refreshToken) {
    throw new OAuthError('MALFORMED_TOKEN', 'claude', 'Claude token response omitted refresh_token')
  }
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
  const scope = optionalString(json, 'scope')
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: optionalString(json, 'token_type') ?? 'Bearer',
    ...(scope ? { scope } : {}),
  }
}

async function postJson(
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
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    const parsed: unknown = text ? JSON.parse(text) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: response.status, json }
}

function requiredString(json: Record<string, unknown>, key: string): string {
  const value = json[key]
  if (typeof value !== 'string' || !value) {
    throw new OAuthError('MALFORMED_TOKEN', 'claude', `Claude response missing ${key}`)
  }
  return value
}

function optionalString(json: Record<string, unknown>, key: string): string | undefined {
  const value = json[key]
  return typeof value === 'string' && value ? value : undefined
}
