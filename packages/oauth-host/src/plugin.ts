import { homedir } from 'node:os'
import { join } from 'node:path'
import { createFileTokenStore, createOAuthSessionManager } from '@dsh-plugin/oauth'
import {
  createClaudeOAuthProvider,
  DEFAULT_CLAUDE_BASE_URL,
} from '@dsh-plugin/oauth-claude'
import {
  createCodexOAuthProvider,
  DEFAULT_CODEX_BASE_URL,
} from '@dsh-plugin/oauth-codex'
import {
  createProxyAwareFetch,
  createXaiOAuthProvider,
  DEFAULT_XAI_AUTHORIZATION_SERVER,
  DEFAULT_XAI_CLIENT_ID,
  DEFAULT_XAI_SCOPE,
} from '@dsh-plugin/oauth-xai'
import { XaiOauthAdapter, XAI_OAUTH_ROUTE } from './adapter.js'
import { CodexOauthAdapter, CODEX_OAUTH_ROUTE } from './codex-adapter.js'
import { ClaudeOauthAdapter, CLAUDE_OAUTH_ROUTE } from './claude-adapter.js'
import {
  handleOAuthHttp,
  CLAUDE_OAUTH_ACCESS_TOKEN_REF,
  CODEX_OAUTH_ACCESS_TOKEN_REF,
  XAI_OAUTH_ACCESS_TOKEN_REF,
} from './http.js'
import { renderXaiSettingsPage } from './page.js'

export const name = 'dsh-oauth-host'
export const inject = ['webServer', 'llm', 'credentials']

export interface HostConfig {
  clientId?: string
  authorizationServer?: string
  scope?: string
  baseURL?: string
  storeDir?: string
  codexClientId?: string
  codexBaseURL?: string
  claudeBaseURL?: string
}

export function resolveHostConfig(raw: HostConfig = {}) {
  return {
    clientId: raw.clientId ?? DEFAULT_XAI_CLIENT_ID,
    authorizationServer: raw.authorizationServer ?? DEFAULT_XAI_AUTHORIZATION_SERVER,
    scope: raw.scope ?? DEFAULT_XAI_SCOPE,
    baseURL: raw.baseURL ?? 'https://api.x.ai/v1',
    storeDir: raw.storeDir ?? join(resolveDshHome(), 'oauth'),
    codexClientId: raw.codexClientId,
    codexBaseURL: raw.codexBaseURL ?? DEFAULT_CODEX_BASE_URL,
    claudeBaseURL: raw.claudeBaseURL ?? DEFAULT_CLAUDE_BASE_URL,
  }
}

export function resolveDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function apply(ctx: HostContext, raw: HostConfig = {}): void {
  const config = resolveHostConfig(raw)
  const store = createFileTokenStore(config.storeDir)
  const proxyFetch = createProxyAwareFetch()
  const provider = createXaiOAuthProvider({
    clientId: config.clientId,
    authorizationServer: config.authorizationServer,
    scope: config.scope,
    fetch: proxyFetch,
  })
  const codexProvider = createCodexOAuthProvider({
    ...(config.codexClientId ? { clientId: config.codexClientId } : {}),
    fetch: proxyFetch,
  })
  const claudeProvider = createClaudeOAuthProvider({
    fetch: proxyFetch,
  })
  const credentials = {
    async set(ref: string, value: string) {
      await ctx.credentials.set(ref, value)
    },
    async unset(ref: string) {
      await ctx.credentials.unset(ref)
    },
    async resolve(ref: string) {
      const resolved = await ctx.credentials.resolve(ref)
      if (!resolved) return undefined
      return typeof resolved === 'string' ? resolved : resolved.value
    },
  }

  const manager = createOAuthSessionManager({
    providers: [provider, codexProvider, claudeProvider],
    store,
    async onAccessToken(providerId: string, accessToken: string | undefined) {
      const ref = providerId === 'xai'
        ? XAI_OAUTH_ACCESS_TOKEN_REF
        : providerId === 'codex'
          ? CODEX_OAUTH_ACCESS_TOKEN_REF
          : providerId === 'claude'
            ? CLAUDE_OAUTH_ACCESS_TOKEN_REF
            : undefined
      if (!ref) return
      if (accessToken) await credentials.set(ref, accessToken)
      else await credentials.unset(ref)
    },
  })

  void manager.restore()

  const adapter = new XaiOauthAdapter({
    sessions: manager,
    baseURL: config.baseURL,
    fetch: proxyFetch,
  })
  const codexAdapter = new CodexOauthAdapter({
    sessions: manager,
    oauthBaseURL: config.codexBaseURL,
    fetch: proxyFetch,
  })
  try {
    ctx.llm.registerAdapter([XAI_OAUTH_ROUTE], adapter)
  } catch (error) {
    console.error('[dsh-oauth-host] registerAdapter(xai-oauth) failed', error)
  }
  try {
    ctx.llm.registerAdapter([CODEX_OAUTH_ROUTE], codexAdapter)
  } catch (error) {
    console.error('[dsh-oauth-host] registerAdapter(codex-oauth) failed', error)
  }
  const claudeAdapter = new ClaudeOauthAdapter({
    sessions: manager,
    baseURL: config.claudeBaseURL,
    fetch: proxyFetch,
  })
  try {
    ctx.llm.registerAdapter([CLAUDE_OAUTH_ROUTE], claudeAdapter)
  } catch (error) {
    console.error('[dsh-oauth-host] registerAdapter(claude-oauth) failed', error)
  }

  const htmlPage = renderXaiSettingsPage()
  const handler = async (req: NodeRequestLike, res: NodeResponseLike) => {
    const rawBody = req.method === 'POST' ? await readBody(req) : ''
    let body: unknown
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = undefined
      }
    }
    try {
      const result = await handleOAuthHttp({
        manager,
        credentials,
        htmlPage,
        async completeAuthorization(providerName, code) {
          if (providerName !== 'claude') {
            throw new Error('this provider does not use a pasted authorization code')
          }
          await claudeProvider.completeAuthorization(code)
        },
        request: {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          remoteAddress: remoteAddress(req),
          headers: normalizeHeaders(req.headers),
          ...(body !== undefined ? { body } : {}),
        },
      })
      res.statusCode = result.status
      for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value)
      if (typeof result.body === 'string') res.end(result.body)
      else res.end(JSON.stringify(result.body))
    } catch (error) {
      if (res.headersSent) return
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'HANDLER'
      res.end(JSON.stringify({ state: 'error', errorCode: code }))
    }
  }

  registerPrefix(ctx.webServer, '/dsh-oauth', handler)
}

async function readBody(req: NodeRequestLike): Promise<string> {
  if (!req[Symbol.asyncIterator]) return ''
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function registerPrefix(
  webServer: HostContext['webServer'],
  path: string,
  handler: (req: NodeRequestLike, res: NodeResponseLike) => Promise<void>,
): void {
  webServer.register({ kind: 'prefix', path, handler })
}

function remoteAddress(req: NodeRequestLike): string {
  const socket = req.socket
  return socket?.remoteAddress ?? '127.0.0.1'
}

function normalizeHeaders(headers: NodeRequestLike['headers']): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
  }
  return result
}

interface NodeRequestLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>
}

interface NodeResponseLike {
  statusCode: number
  headersSent?: boolean
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export interface HostContext {
  webServer: {
    register(route: { kind: 'prefix' | 'exact'; path: string; handler: unknown }): unknown
  }
  llm: {
    registerAdapter(routes: string[], adapter: unknown): unknown
  }
  credentials: {
    set(ref: string, value: string): Promise<void>
    unset(ref: string): Promise<void>
    resolve(ref: string): Promise<string | { value: string } | undefined>
  }
}
