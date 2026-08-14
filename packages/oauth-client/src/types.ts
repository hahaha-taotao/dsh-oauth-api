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
