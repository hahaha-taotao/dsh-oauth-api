import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OAuthError, STORE_VERSION, type StoredSession, type TokenStore } from './types.js'

export function createFileTokenStore(directory: string): TokenStore {
  return {
    async read(provider) {
      const path = join(directory, `${provider}.json`)
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (error) {
        if (isNotFound(error)) return undefined
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return parseStoredSession(provider, parsed)
    },
    async write(session) {
      await mkdir(directory, { recursive: true })
      const path = join(directory, `${session.provider}.json`)
      await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    },
    async clear(provider) {
      const path = join(directory, `${provider}.json`)
      try {
        await rm(path)
      } catch (error) {
        if (isNotFound(error)) return
        throw error
      }
    },
  }
}

function parseStoredSession(provider: string, value: unknown): StoredSession {
  if (!value || typeof value !== 'object') {
    throw new OAuthError('STORE_CORRUPT', provider, 'OAuth store is not an object')
  }
  const record = value as Record<string, unknown>
  if (record.version !== STORE_VERSION) {
    throw new OAuthError('STORE_VERSION', provider, `unsupported OAuth store version: ${String(record.version)}`)
  }
  const accessToken = requiredString(record, 'accessToken', provider)
  const refreshToken = requiredString(record, 'refreshToken', provider)
  const expiresAt = requiredNumber(record, 'expiresAt', provider)
  const tokenType = requiredString(record, 'tokenType', provider)
  const refreshDead = record.refreshDead === true
  const scope = typeof record.scope === 'string' ? record.scope : undefined
  return {
    version: STORE_VERSION,
    provider,
    accessToken,
    refreshToken,
    expiresAt,
    tokenType,
    refreshDead,
    ...(scope !== undefined ? { scope } : {}),
  }
}

function requiredString(record: Record<string, unknown>, key: string, provider: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthError('STORE_CORRUPT', provider, `OAuth store missing ${key}`)
  }
  return value
}

function requiredNumber(record: Record<string, unknown>, key: string, provider: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OAuthError('STORE_CORRUPT', provider, `OAuth store missing ${key}`)
  }
  return value
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
