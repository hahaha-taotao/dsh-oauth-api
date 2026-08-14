import { describe, expect, it } from 'vitest'
import { apply } from './plugin.js'

describe('host plugin apply', () => {
  it('registers the HTTP prefix and llm route without touching the default model', () => {
    const registered: unknown[] = []
    const adapters: string[][] = []
    let defaultModelWrites = 0
    const ctx = {
      webServer: {
        register(route: unknown) {
          registered.push(route)
        },
      },
      llm: {
        registerAdapter(routes: string[], adapter: {
          providerInfo(provider: string): { id: string; name: string }
          providerRetryPolicy(provider: string): unknown
        }) {
          for (const route of routes) {
            const info = adapter.providerInfo(route)
            if (info.id !== route || !info.name) {
              throw new Error(`invalid provider metadata for ${route}`)
            }
            adapter.providerRetryPolicy(route)
          }
          adapters.push(routes)
        },
      },
      credentials: {
        async set() {},
        async unset() {},
        async resolve() {
          return undefined
        },
      },
      agentDefaultModel: {
        set() {
          defaultModelWrites += 1
        },
      },
    }
    apply(ctx)
    expect(registered.length).toBeGreaterThan(0)
    expect(adapters).toEqual([['xai-oauth'], ['codex-oauth'], ['claude-oauth']])
    expect(defaultModelWrites).toBe(0)
  })
})
