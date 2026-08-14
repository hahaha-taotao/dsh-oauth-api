import type { SessionSnapshot } from './types.js'

export interface SettingsApi {
  login(): Promise<SessionSnapshot>
  status(): Promise<SessionSnapshot>
  cancel(): Promise<SessionSnapshot>
  logout(): Promise<SessionSnapshot>
}

export function createXaiSettingsApi(doFetch: typeof fetch = fetch): SettingsApi {
  return {
    login: () => send(doFetch, 'POST', '/dsh-oauth/xai/login'),
    status: () => send(doFetch, 'GET', '/dsh-oauth/xai/status'),
    cancel: () => send(doFetch, 'POST', '/dsh-oauth/xai/cancel'),
    logout: () => send(doFetch, 'POST', '/dsh-oauth/xai/logout'),
  }
}

async function send(
  doFetch: typeof fetch,
  method: string,
  path: string,
  body?: unknown,
): Promise<SessionSnapshot> {
  const response = await doFetch(path, {
    method,
    ...(body
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  const text = await response.text()
  if (/(accessToken|refreshToken|deviceCode|"atk"|"rtk")/.test(text)) {
    throw new Error('host response leaked token fields')
  }
  return JSON.parse(text) as SessionSnapshot
}
