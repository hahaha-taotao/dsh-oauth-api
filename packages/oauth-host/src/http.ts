import { ProviderId, type OAuthSessionManager, type SessionSnapshot } from '@dsh-plugin/oauth'

export const XAI_OAUTH_ACCESS_TOKEN_REF = 'XAI_OAUTH_ACCESS_TOKEN'
export const CODEX_OAUTH_ACCESS_TOKEN_REF = 'CODEX_OAUTH_ACCESS_TOKEN'
export const CLAUDE_OAUTH_ACCESS_TOKEN_REF = 'CLAUDE_OAUTH_ACCESS_TOKEN'
export const KIMI_OAUTH_ACCESS_TOKEN_REF = 'KIMI_OAUTH_ACCESS_TOKEN'

const PROVIDERS = {
  xai: { accessRef: XAI_OAUTH_ACCESS_TOKEN_REF },
  codex: { accessRef: CODEX_OAUTH_ACCESS_TOKEN_REF },
  claude: { accessRef: CLAUDE_OAUTH_ACCESS_TOKEN_REF },
  kimi: { accessRef: KIMI_OAUTH_ACCESS_TOKEN_REF },
} as const

type OauthProviderName = keyof typeof PROVIDERS

export interface CredentialsMirror {
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

export interface HttpRequestView {
  readonly method: string
  readonly url: string
  readonly remoteAddress: string
  readonly headers: Record<string, string | undefined>
  readonly body?: unknown
}

export interface HttpResponseView {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: unknown
}

export async function handleOAuthHttp(input: {
  manager: OAuthSessionManager
  credentials?: CredentialsMirror
  htmlPage?: string
  completeAuthorization?: (provider: OauthProviderName, code: string) => Promise<void>
  request: HttpRequestView
}): Promise<HttpResponseView> {
  if (!isLoopback(input.request.remoteAddress) || !isTrustedOrigin(input.request)) {
    return json(403, { state: 'error', errorCode: 'FORBIDDEN' })
  }

  const path = pathOnly(input.request.url)
  const method = input.request.method.toUpperCase()
  const parsed = parseOauthPath(path)
  if (!parsed) return json(404, { state: 'error', errorCode: 'NOT_FOUND' })
  const id = ProviderId(parsed.provider)
  const refs = PROVIDERS[parsed.provider]

  if (method === 'GET' && parsed.action === '') {
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: input.htmlPage ?? '',
    }
  }
  if (method === 'POST' && parsed.action === 'login') {
    try {
      const snapshot = await input.manager.startLogin(id)
      return json(200, publicSnapshot(snapshot))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'DEVICE_CODE_FAILED'
      const errorMessage = error instanceof Error ? error.message : String(error)
      return json(200, { state: 'error', errorCode: code, errorMessage })
    }
  }
  if (method === 'GET' && parsed.action === 'status') {
    return json(200, publicSnapshot(input.manager.snapshot(id)))
  }
  if (method === 'POST' && parsed.action === 'cancel') {
    input.manager.cancelLogin(id)
    return json(200, publicSnapshot(input.manager.snapshot(id)))
  }
  if (method === 'POST' && parsed.action === 'logout') {
    await input.manager.logout(id)
    await input.credentials?.unset(refs.accessRef)
    return json(200, publicSnapshot(input.manager.snapshot(id)))
  }
  if (method === 'POST' && parsed.action === 'complete') {
    const code = readCompleteCode(input.request.body)
    if (!code) return json(400, { state: 'error', errorCode: 'INVALID_CODE' })
    try {
      await input.completeAuthorization?.(parsed.provider, code)
      return json(200, publicSnapshot(input.manager.snapshot(id)))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return json(200, { state: 'error', errorCode: 'TOKEN_ERROR', errorMessage })
    }
  }
  return json(404, { state: 'error', errorCode: 'NOT_FOUND' })
}

function parseOauthPath(path: string): { provider: OauthProviderName; action: string } | undefined {
  const match = /^\/dsh-oauth\/(xai|codex|claude|kimi)(?:\/([^/]*))?$/.exec(path)
  if (!match) return undefined
  return { provider: match[1] as OauthProviderName, action: match[2] ?? '' }
}

export function publicSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    state: snapshot.state,
    ...(snapshot.userCode !== undefined ? { userCode: snapshot.userCode } : {}),
    ...(snapshot.verificationUri !== undefined ? { verificationUri: snapshot.verificationUri } : {}),
    ...(snapshot.verificationUriComplete !== undefined
      ? { verificationUriComplete: snapshot.verificationUriComplete }
      : {}),
    ...(snapshot.expiresAt !== undefined ? { expiresAt: snapshot.expiresAt } : {}),
    ...(snapshot.errorCode !== undefined ? { errorCode: snapshot.errorCode } : {}),
    ...(snapshot.errorMessage !== undefined ? { errorMessage: snapshot.errorMessage } : {}),
  }
}

function readCompleteCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value = (body as { code?: unknown }).code
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function json(status: number, body: unknown): HttpResponseView {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body,
  }
}

function pathOnly(url: string): string {
  const parsed = new URL(url, 'http://127.0.0.1')
  return parsed.pathname
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1'
    || address === '::1'
    || address === ':1'
    || address === 'localhost'
    || address === '::ffff:127.0.0.1'
}

function isTrustedOrigin(request: HttpRequestView): boolean {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch {
    return false
  }
}
