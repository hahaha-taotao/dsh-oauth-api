import { describe, expect, it } from 'vitest'
import { ProviderId, createMemoryTokenStore, createOAuthSessionManager, OAuthError, type OAuthProvider } from '@dsh-plugin/oauth'
import { XaiOauthAdapter } from './adapter.js'

function provider(): OAuthProvider {
  return {
    id: ProviderId('xai'),
    displayName: 'xAI',
    startDeviceCode: async () => {
      throw new Error('unused')
    },
    pollToken: async () => ({ status: 'pending' }),
    refresh: async () => {
      throw new OAuthError('INVALID_GRANT', 'xai', 'dead')
    },
  }
}

async function storeOauth(store: ReturnType<typeof createMemoryTokenStore>, token = 'xai-oauth-token') {
  await store.write({
    version: 1,
    provider: 'xai',
    accessToken: token,
    refreshToken: 'rtk',
    expiresAt: Date.now() + 10 * 60_000,
    tokenType: 'Bearer',
    refreshDead: false,
  })
}

describe('XaiOauthAdapter auth selection', () => {
  it('sends the OAuth access token', async () => {
    const store = createMemoryTokenStore()
    await storeOauth(store)
    const manager = createOAuthSessionManager({ providers: [provider()], store })
    const seen: string[] = []
    const adapter = new XaiOauthAdapter({
      sessions: manager,
      baseURL: 'https://api.x.ai/v1',
      fetch: async (_url, init) => {
        seen.push(String((init?.headers as Record<string, string>).authorization))
        return new Response([
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"ok"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
          '',
        ].join('\n'), { headers: { 'content-type': 'text/event-stream' } })
      },
    })

    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'xai-oauth', model: 'grok-4.6', messages: [] })) {
      chunks.push(chunk)
    }
    expect(seen[0]).toBe('Bearer xai-oauth-token')
    expect(chunks.some((chunk) => chunk.type === 'finish')).toBe(true)
  })

  it('sends flattened Responses input instead of harness content blocks', async () => {
    const store = createMemoryTokenStore()
    await storeOauth(store)
    const manager = createOAuthSessionManager({ providers: [provider()], store })
    let body: Record<string, unknown> | undefined
    const adapter = new XaiOauthAdapter({
      sessions: manager,
      baseURL: 'https://api.x.ai/v1',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          [
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"ok"}',
            '',
            'event: response.completed',
            'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
            '',
          ].join('\n'),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })

    for await (const _chunk of adapter.stream({
      provider: 'xai-oauth',
      model: 'grok-4.6',
      system: 'You are Grok',
      messages: [{ role: 'user', id: 'm1', content: [{ type: 'text', text: '你好' }] }],
    })) {
      void _chunk
    }

    expect(body?.input).toEqual([{ role: 'user', content: '你好' }])
    expect(body?.instructions).toBe('You are Grok')
    expect(body?.store).toBe(false)
    expect(JSON.stringify(body?.input)).not.toContain('"type":"text"')
  })

  it('advertises official catalog fields so the model picker can list Grok', async () => {
    const store = createMemoryTokenStore()
    const manager = createOAuthSessionManager({ providers: [provider()], store })
    const adapter = new XaiOauthAdapter({
      sessions: manager,
      baseURL: 'https://api.x.ai/v1',
    })

    const info = adapter.providerInfo('xai-oauth')
    expect(info).toEqual({ id: 'xai-oauth', name: 'Grok / xAI' })
    expect(adapter.providerRetryPolicy('xai-oauth')).toBeUndefined()

    const models = await adapter.listModels('xai-oauth')
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.provider).toBe('xai-oauth')
      expect(model.id.length).toBeGreaterThan(0)
      expect(model.name.length).toBeGreaterThan(0)
    }

    const resolved = await adapter.resolveModel('xai-oauth', models[0].id)
    expect(resolved).toMatchObject({
      provider: 'xai-oauth',
      id: models[0].id,
      name: models[0].name,
    })
    expect('model' in resolved).toBe(false)
    expect(resolved.reasoning?.efforts.map((effort) => effort.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(resolved.reasoning?.defaultEffort).toBe('high')
  })

  it('refuses an OAuth JWT that lacks api:access before calling xAI', async () => {
    const store = createMemoryTokenStore()
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${encode({ alg: 'none' })}.${encode({ scope: 'openid offline_access grok-cli:access' })}.sig`
    await store.write({
      version: 1,
      provider: 'xai',
      accessToken: token,
      refreshToken: 'rtk',
      expiresAt: Date.now() + 60_000,
      tokenType: 'Bearer',
      refreshDead: false,
      scope: 'openid offline_access grok-cli:access',
    })
    const manager = createOAuthSessionManager({ providers: [provider()], store })
    const adapter = new XaiOauthAdapter({
      sessions: manager,
      baseURL: 'https://api.x.ai/v1',
      fetch: async () => {
        throw new Error('must not call xAI')
      },
    })

    await expect(async () => {
      for await (const _chunk of adapter.stream({
        provider: 'xai-oauth',
        model: 'grok-4.6',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        void _chunk
      }
    }).rejects.toMatchObject({
      code: 'AUTH',
      provider: 'xai',
    })
  })
})
