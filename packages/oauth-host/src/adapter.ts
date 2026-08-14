import { OAuthError, ProviderId, type OAuthSessionManager } from '@dsh-plugin/oauth'
import { accessTokenGrantsXaiApi } from './scope-check.js'
import { translateResponsesSse, type StreamChunk } from './responses.js'
import { serializeResponsesRequest, type HarnessGenerateOptions } from './serialize.js'
import { reasoningForModel } from './reasoning.js'

export const XAI_OAUTH_ROUTE = 'xai-oauth'

export const DEFAULT_XAI_MODELS = [
  { id: 'grok-4.6', name: 'Grok 4.6' },
  { id: 'grok-4.5', name: 'Grok 4.5' },
  { id: 'grok-4.3', name: 'Grok 4.3' },
  { id: 'grok-build-0.1', name: 'Grok Build 0.1' },
] as const

export type GenerateOptions = HarnessGenerateOptions

export class XaiOauthAdapter {
  constructor(
    private readonly options: {
      readonly sessions: OAuthSessionManager
      readonly baseURL: string
      readonly fetch?: typeof fetch
    },
  ) {}

  providerInfo(provider: string) {
    return { id: provider, name: 'Grok / xAI' }
  }

  // Official LlmRuntime.prepareRoutes calls this; a missing method throws
  // TypeError and the adapter never appears in the model picker.
  providerRetryPolicy(_provider: string) {
    return undefined
  }

  listModels(provider: string) {
    return Promise.resolve(
      DEFAULT_XAI_MODELS.map((model) => ({
        provider,
        id: model.id,
        name: model.name,
      })),
    )
  }

  resolveModel(provider: string, model: string) {
    const known = DEFAULT_XAI_MODELS.find((entry) => entry.id === model)
    const reasoning = reasoningForModel(model)
    return Promise.resolve({
      provider,
      id: model,
      name: known?.name ?? model,
      reasoning: {
        efforts: reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
        defaultEffort: reasoning.defaultEffort,
      },
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const token = await this.resolveToken()
    if (!accessTokenGrantsXaiApi(token)) {
      throw new OAuthError(
        'AUTH',
        'xai',
        'OAuth token missing api:access; re-login in Settings → Grok / xAI',
      )
    }
    const baseURL = this.options.baseURL.replace(/\/$/, '')
    const doFetch = this.options.fetch ?? fetch
    const response = await doFetch(`${baseURL}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(serializeResponsesRequest(options)),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (response.status === 401) {
      throw new OAuthError('AUTH', 'xai', 'xAI rejected the bearer token')
    }
    if (response.status === 403) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      if (/api:access/i.test(detail)) {
        throw new OAuthError(
          'AUTH',
          'xai',
          'OAuth token missing api:access; re-login in Settings → Grok / xAI',
        )
      }
      throw new OAuthError(
        'QUOTA',
        'xai',
        detail || 'xAI refused the OAuth inference request; re-login',
      )
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      throw new OAuthError(
        'HTTP_ERROR',
        'xai',
        detail ? `xAI Responses HTTP ${response.status}: ${detail}` : `xAI Responses HTTP ${response.status}`,
      )
    }
    if (!response.body) {
      throw new OAuthError('STREAM_CLOSED', 'xai', 'xAI Responses body was empty')
    }
    yield* translateResponsesSse(readTextStream(response.body))
  }

  private resolveToken(): Promise<string> {
    return this.options.sessions.getAccessToken(ProviderId('xai'))
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
