export function accessTokenGrantsXaiApi(token: string): boolean {
  const scope = readJwtScope(token)
  if (scope === undefined) return true
  return scope.split(/\s+/).includes('api:access')
}

function readJwtScope(token: string): string | undefined {
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
