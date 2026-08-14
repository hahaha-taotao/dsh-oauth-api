import { describe, expect, it } from 'vitest'
import { ProviderId, createMemoryTokenStore, createOAuthSessionManager, OAuthError, type OAuthProvider } from '@dsh-plugin/oauth'
import { KimiOauthAdapter } from './kimi-adapter.js'

function provider(): OAuthProvider {
  return {
    id: ProviderId('kimi'),
    displayName: 'Kimi Code',
    startDeviceCode: async () => {
      throw new Error('unused')
    },
    pollToken: async () => ({ status: 'pending' }),
    refresh: async () => {
      throw new OAuthError('INVALID_GRANT', 'kimi', 'dead')
    },
  }
}

describe('KimiOauthAdapter catalog', () => {
  it('advertises Kimi Code models and K3 reasoning efforts', async () => {
    const adapter = new KimiOauthAdapter({
      sessions: createOAuthSessionManager({ providers: [provider()], store: createMemoryTokenStore() }),
      baseURL: 'https://api.kimi.com/coding/v1',
    })
    expect(adapter.providerInfo('kimi-oauth')).toEqual({ id: 'kimi-oauth', name: 'Kimi Code' })
    const models = await adapter.listModels('kimi-oauth')
    expect(models.map((model) => model.id)).toEqual([
      'k3',
      'k3-256k',
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ])
    const k3 = await adapter.resolveModel('kimi-oauth', 'k3')
    expect(k3.reasoning?.efforts.map((effort) => effort.id)).toEqual(['low', 'high', 'max'])
  })

  it('sends the OAuth bearer and required User-Agent', async () => {
    const store = createMemoryTokenStore()
    await store.write({
      version: 1,
      provider: 'kimi',
      accessToken: 'kimi-atk',
      refreshToken: 'rtk',
      expiresAt: Date.now() + 10 * 60_000,
      tokenType: 'Bearer',
      refreshDead: false,
    })
    const manager = createOAuthSessionManager({ providers: [provider()], store })
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
    const adapter = new KimiOauthAdapter({
      sessions: manager,
      baseURL: 'https://api.kimi.com/coding/v1',
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          headers: init?.headers as Record<string, string>,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        })
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'kimi-oauth',
      model: 'k3',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      chunks.push(chunk)
    }
    expect(seen[0].url).toBe('https://api.kimi.com/coding/v1/chat/completions')
    expect(seen[0].headers.authorization).toBe('Bearer kimi-atk')
    expect(seen[0].headers['user-agent']).toBe('KimiCLI/1.5')
    expect(seen[0].body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(chunks.some((chunk) => chunk.type === 'finish')).toBe(true)
  })
})
