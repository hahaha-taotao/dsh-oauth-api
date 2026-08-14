import { OAuthError, ProviderId, type OAuthSessionManager } from '@dsh-plugin/oauth'
import { DEFAULT_KIMI_USER_AGENT } from '@dsh-plugin/oauth-kimi'
import { serializeChatRequest, translateChatSse } from './chat.js'
import type { StreamChunk } from './responses.js'
import type { HarnessGenerateOptions } from './serialize.js'

export const KIMI_OAUTH_ROUTE = 'kimi-oauth'

export const DEFAULT_KIMI_MODELS = [
  { id: 'k3', name: 'Kimi K3' },
  { id: 'k3-256k', name: 'Kimi K3 256K' },
  { id: 'kimi-for-coding', name: 'Kimi K2.7 Code' },
  { id: 'kimi-for-coding-highspeed', name: 'Kimi K2.7 Code HighSpeed' },
] as const

const K3_REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
} as const

export class KimiOauthAdapter {
  constructor(
    private readonly options: {
      readonly sessions: OAuthSessionManager
      readonly baseURL: string
      readonly fetch?: typeof fetch
      readonly userAgent?: string
    },
  ) {}

  providerInfo(provider: string) {
    return { id: provider, name: 'Kimi Code' }
  }

  providerRetryPolicy(_provider: string) {
    return undefined
  }

  listModels(provider: string) {
    return Promise.resolve(
      DEFAULT_KIMI_MODELS.map((model) => ({
        provider,
        id: model.id,
        name: model.name,
      })),
    )
  }

  resolveModel(provider: string, model: string) {
    const known = DEFAULT_KIMI_MODELS.find((entry) => entry.id === model)
    const k3 = model === 'k3' || model.startsWith('k3-')
    return Promise.resolve({
      provider,
      id: model,
      name: known?.name ?? model,
      ...(k3
        ? {
            reasoning: {
              efforts: K3_REASONING.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
              defaultEffort: K3_REASONING.defaultEffort,
            },
          }
        : {}),
    })
  }

  async *stream(options: HarnessGenerateOptions): AsyncIterable<StreamChunk> {
    const token = await this.options.sessions.getAccessToken(ProviderId('kimi'))
    const doFetch = this.options.fetch ?? fetch
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'user-agent': this.options.userAgent ?? DEFAULT_KIMI_USER_AGENT,
    }
    const response = await doFetch(`${this.options.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(serializeChatRequest(options)),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (response.status === 401) {
      throw new OAuthError('AUTH', 'kimi', 'Kimi rejected the credential')
    }
    if (response.status === 403) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      throw new OAuthError(
        'QUOTA',
        'kimi',
        detail || 'Kimi refused the OAuth inference request; re-login',
      )
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      throw new OAuthError(
        'HTTP_ERROR',
        'kimi',
        detail ? `Kimi chat HTTP ${response.status}: ${detail}` : `Kimi chat HTTP ${response.status}`,
      )
    }
    if (!response.body) {
      throw new OAuthError('STREAM_CLOSED', 'kimi', 'Kimi chat body was empty')
    }
    yield* translateChatSse(readTextStream(response.body))
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
