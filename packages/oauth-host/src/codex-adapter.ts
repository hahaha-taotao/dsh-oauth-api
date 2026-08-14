import { OAuthError, ProviderId, type OAuthSessionManager } from '@dsh-plugin/oauth'
import { chatgptAccountId } from '@dsh-plugin/oauth-codex'
import { translateResponsesSse, type StreamChunk } from './responses.js'
import { serializeResponsesRequest, type HarnessGenerateOptions } from './serialize.js'

export const CODEX_OAUTH_ROUTE = 'codex-oauth'

export const DEFAULT_CODEX_MODELS = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
] as const

const CODEX_REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'xhigh', name: 'Xhigh' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
} as const

export class CodexOauthAdapter {
  constructor(
    private readonly options: {
      readonly sessions: OAuthSessionManager
      readonly oauthBaseURL: string
      readonly fetch?: typeof fetch
    },
  ) {}

  providerInfo(provider: string) {
    return { id: provider, name: 'Codex / ChatGPT' }
  }

  providerRetryPolicy(_provider: string) {
    return undefined
  }

  listModels(provider: string) {
    return Promise.resolve(
      DEFAULT_CODEX_MODELS.map((model) => ({
        provider,
        id: model.id,
        name: model.name,
      })),
    )
  }

  resolveModel(provider: string, model: string) {
    const known = DEFAULT_CODEX_MODELS.find((entry) => entry.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: known?.name ?? model,
      reasoning: {
        efforts: CODEX_REASONING.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
        defaultEffort: CODEX_REASONING.defaultEffort,
      },
    })
  }

  async *stream(options: HarnessGenerateOptions): AsyncIterable<StreamChunk> {
    const auth = await this.resolveAuth()
    const doFetch = this.options.fetch ?? fetch
    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    }
    headers.originator = 'codex_cli_rs'
    headers['openai-beta'] = 'responses=experimental'
    headers['user-agent'] = 'codex_cli_rs/0.1.0'
    if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId
    const response = await doFetch(`${auth.baseURL}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(serializeResponsesRequest(options)),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (response.status === 401) {
      throw new OAuthError('AUTH', 'codex', 'Codex rejected the bearer token')
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      throw new OAuthError(
        'HTTP_ERROR',
        'codex',
        detail ? `Codex Responses HTTP ${response.status}: ${detail}` : `Codex Responses HTTP ${response.status}`,
      )
    }
    if (!response.body) {
      throw new OAuthError('STREAM_CLOSED', 'codex', 'Codex Responses body was empty')
    }
    yield* translateResponsesSse(readTextStream(response.body))
  }

  private async resolveAuth(): Promise<{ token: string; baseURL: string; accountId?: string }> {
    const token = await this.options.sessions.getAccessToken(ProviderId('codex'))
    const accountId = chatgptAccountId(token)
    if (accountId) {
      return {
        token,
        baseURL: this.options.oauthBaseURL.replace(/\/$/, ''),
        accountId,
      }
    }
    return {
      token,
      baseURL: this.options.oauthBaseURL.replace(/\/$/, ''),
    }
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
