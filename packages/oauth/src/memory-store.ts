import type { StoredSession, TokenStore } from './types.js'

export function createMemoryTokenStore(initial: readonly StoredSession[] = []): TokenStore {
  const map = new Map<string, StoredSession>(initial.map((session) => [session.provider, session]))
  return {
    async read(provider) {
      return map.get(provider)
    },
    async write(session) {
      map.set(session.provider, session)
    },
    async clear(provider) {
      map.delete(provider)
    },
  }
}
