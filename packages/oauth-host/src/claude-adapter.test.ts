import { describe, expect, it } from 'vitest'
import { ProviderId, createMemoryTokenStore, createOAuthSessionManager, OAuthError, type OAuthProvider } from '@dsh-plugin/oauth'
import { ClaudeOauthAdapter } from './claude-adapter.js'

function provider(): OAuthProvider {
  return {
    id: ProviderId('claude'),
    displayName: 'Claude Code',
    startDeviceCode: async () => {
      throw new Error('unused')
    },
    pollToken: async () => ({ status: 'pending' }),
    refresh: async () => {
      throw new OAuthError('INVALID_GRANT', 'claude', 'dead')
    },
  }
}

describe('ClaudeOauthAdapter catalog', () => {
  it('advertises Claude models with thinking efforts', async () => {
    const adapter = new ClaudeOauthAdapter({
      sessions: createOAuthSessionManager({ providers: [provider()], store: createMemoryTokenStore() }),
      baseURL: 'https://api.anthropic.com',
    })
    expect(adapter.providerInfo('claude-oauth')).toEqual({ id: 'claude-oauth', name: 'Claude Code' })
    const models = await adapter.listModels('claude-oauth')
    expect(models.map((model) => model.id)).toContain('claude-sonnet-4-6')
    const resolved = await adapter.resolveModel('claude-oauth', 'claude-sonnet-4-6')
    expect(resolved.reasoning?.efforts.map((effort) => effort.id)).toContain('off')
  })
})
