export const XAI_API_ACCESS_SCOPE = 'api:access'

/** Hermes / OpenClaw Family A scope. `api:access` is required by api.x.ai. */
export const DEFAULT_XAI_SCOPE = `openid profile email offline_access grok-cli:access ${XAI_API_ACCESS_SCOPE}`

export function hasXaiApiAccessScope(scope: string | undefined): boolean {
  if (!scope) return false
  return scope.split(/\s+/).includes(XAI_API_ACCESS_SCOPE)
}

export function accessTokenGrantsXaiApi(token: string): boolean {
  const scope = readJwtScope(token)
  if (scope === undefined) return true
  return hasXaiApiAccessScope(scope)
}

export function readJwtScope(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload: unknown = JSON.parse(json)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
    const scope = (payload as { scope?: unknown }).scope
    return typeof scope === 'string' ? scope : undefined
  } catch {
    return undefined
  }
}
