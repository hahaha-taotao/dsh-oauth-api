export type ProviderId = string & { readonly __brand: 'OAuthProviderId' }

export function ProviderId(id: string): ProviderId {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error(`invalid OAuth provider id: ${id}`)
  }
  return id as ProviderId
}

export interface DeviceCodeChallenge {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly verificationUriComplete?: string
  readonly expiresAt: number
  readonly intervalMs: number
}

export interface TokenSet {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly tokenType: string
  readonly scope?: string
}

export type PollResult =
  | { readonly status: 'pending' }
  | { readonly status: 'slow_down'; readonly intervalMs: number }
  | { readonly status: 'approved'; readonly tokens: TokenSet }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' }

export interface OAuthProvider {
  readonly id: ProviderId
  readonly displayName: string
  startDeviceCode(signal?: AbortSignal): Promise<DeviceCodeChallenge>
  pollToken(challenge: DeviceCodeChallenge, signal?: AbortSignal): Promise<PollResult>
  refresh(refreshToken: string, signal?: AbortSignal): Promise<TokenSet>
}

export const STORE_VERSION = 1 as const

export interface StoredSession {
  readonly version: typeof STORE_VERSION
  readonly provider: string
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly tokenType: string
  readonly scope?: string
  readonly refreshDead: boolean
}

export interface TokenStore {
  read(provider: string): Promise<StoredSession | undefined>
  write(session: StoredSession): Promise<void>
  clear(provider: string): Promise<void>
}

export type SessionState = 'logged_out' | 'pending' | 'logged_in' | 'error'

export interface SessionSnapshot {
  readonly state: SessionState
  readonly userCode?: string
  readonly verificationUri?: string
  readonly verificationUriComplete?: string
  readonly expiresAt?: number
  readonly errorCode?: string
  readonly errorMessage?: string
}

export class OAuthError extends Error {
  readonly code: string
  readonly provider: string

  constructor(code: string, provider: string, message: string) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
    this.provider = provider
  }
}
