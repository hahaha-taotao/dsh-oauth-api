import { describe, expect, it } from 'vitest'
import { ProviderId, createMemoryTokenStore, createOAuthSessionManager, OAuthError, type OAuthProvider } from '@dsh-plugin/oauth'
import { CodexOauthAdapter } from './codex-adapter.js'

function provider(): OAuthProvider {
  return {
    id: ProviderId('codex'),
    displayName: 'Codex / ChatGPT',
    startDeviceCode: async () => {
      throw new Error('unused')
    },
    pollToken: async () => ({ status: 'pending' }),
    refresh: async () => {
      throw new OAuthError('INVALID_GRANT', 'codex', 'dead')
    },
  }
}

describe('CodexOauthAdapter catalog', () => {
  it('advertises GPT-5.6 models with reasoning efforts', async () => {
    const adapter = new CodexOauthAdapter({
      sessions: createOAuthSessionManager({ providers: [provider()], store: createMemoryTokenStore() }),
      oauthBaseURL: 'https://chatgpt.com/backend-api/codex',
    })
    const info = adapter.providerInfo('codex-oauth')
    expect(info).toEqual({ id: 'codex-oauth', name: 'Codex / ChatGPT' })
    const models = await adapter.listModels('codex-oauth')
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
    const resolved = await adapter.resolveModel('codex-oauth', 'gpt-5.6-sol')
    expect(resolved.reasoning?.defaultEffort).toBe('high')
    expect(resolved.reasoning?.efforts.map((effort) => effort.id)).toContain('xhigh')
  })
})
