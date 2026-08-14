import { OAuthError, ProviderId, type OAuthSessionManager } from '@dsh-plugin/oauth'
import { serializeAnthropicRequest, translateAnthropicSse } from './anthropic.js'
import type { StreamChunk } from './responses.js'
import type { HarnessGenerateOptions } from './serialize.js'

export const CLAUDE_OAUTH_ROUTE = 'claude-oauth'

export const DEFAULT_CLAUDE_MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
] as const

const CLAUDE_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
} as const

export class ClaudeOauthAdapter {
  constructor(
    private readonly options: {
      readonly sessions: OAuthSessionManager
      readonly baseURL: string
      readonly fetch?: typeof fetch
    },
  ) {}

  providerInfo(provider: string) {
    return { id: provider, name: 'Claude Code' }
  }

  providerRetryPolicy(_provider: string) {
    return undefined
  }

  listModels(provider: string) {
    return Promise.resolve(
      DEFAULT_CLAUDE_MODELS.map((model) => ({
        provider,
        id: model.id,
        name: model.name,
      })),
    )
  }

  resolveModel(provider: string, model: string) {
    const known = DEFAULT_CLAUDE_MODELS.find((entry) => entry.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: known?.name ?? model,
      reasoning: {
        efforts: CLAUDE_REASONING.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
        defaultEffort: CLAUDE_REASONING.defaultEffort,
      },
    })
  }

  async *stream(options: HarnessGenerateOptions): AsyncIterable<StreamChunk> {
    const token = await this.options.sessions.getAccessToken(ProviderId('claude'))
    const doFetch = this.options.fetch ?? fetch
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219',
    }
    const response = await doFetch(`${this.options.baseURL.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(serializeAnthropicRequest(options)),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (response.status === 401) {
      throw new OAuthError('AUTH', 'claude', 'Claude rejected the credential')
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      throw new OAuthError(
        'HTTP_ERROR',
        'claude',
        detail ? `Claude Messages HTTP ${response.status}: ${detail}` : `Claude Messages HTTP ${response.status}`,
      )
    }
    if (!response.body) {
      throw new OAuthError('STREAM_CLOSED', 'claude', 'Claude Messages body was empty')
    }
    yield* translateAnthropicSse(readTextStream(response.body))
  }
}

async function* readTextStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield decoder.decode(value, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}
