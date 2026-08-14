import { describe, expect, it } from 'vitest'
import { createXaiOAuthProvider } from './provider.js'

interface RecordedRequest {
  url: string
  body: string
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function formResponse(status: number, body: unknown): Response {
  return jsonResponse(status, body)
}

describe('xAI device-code provider', () => {
  it('starts a device-code challenge from the authorization server', async () => {
    const seen: RecordedRequest[] = []
    const provider = createXaiOAuthProvider({
      clientId: 'test-client',
      authorizationServer: 'https://accounts.x.ai',
      scope: 'offline_access',
      fetch: async (input, init) => {
        const url = String(input)
        seen.push({ url, body: String(init?.body ?? '') })
        return formResponse(200, {
          device_code: 'dev-1',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://accounts.x.ai/oauth2/device',
          verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=WDJB-MJHT',
          expires_in: 1800,
          interval: 5,
        })
      },
    })

    const challenge = await provider.startDeviceCode()

    expect(provider.id).toBe('xai')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://accounts.x.ai/oauth2/device/code')
    expect(seen[0].body).toContain('client_id=test-client')
    expect(seen[0].body).toContain('scope=offline_access')
    expect(challenge.deviceCode).toBe('dev-1')
    expect(challenge.userCode).toBe('WDJB-MJHT')
    expect(challenge.verificationUri).toBe('https://accounts.x.ai/oauth2/device')
    expect(challenge.verificationUriComplete).toBe(
      'https://accounts.x.ai/oauth2/device?user_code=WDJB-MJHT',
    )
    expect(challenge.intervalMs).toBe(5000)
    expect(challenge.expiresAt).toBeGreaterThan(Date.now())
  })

  it('maps authorization_pending and slow_down while polling', async () => {
    const replies = [
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 8 },
      {
        access_token: 'atk',
        refresh_token: 'rtk',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'offline_access',
      },
    ]
    const provider = createXaiOAuthProvider({
      clientId: 'test-client',
      fetch: async () => {
        const next = replies.shift()
        if (!next) throw new Error('unexpected extra poll')
        return formResponse('error' in next ? 400 : 200, next)
      },
    })

    const challenge = {
      deviceCode: 'dev-1',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://accounts.x.ai/oauth2/device',
      expiresAt: Date.now() + 60_000,
      intervalMs: 5000,
    }

    await expect(provider.pollToken(challenge)).resolves.toEqual({ status: 'pending' })
    await expect(provider.pollToken(challenge)).resolves.toEqual({
      status: 'slow_down',
      intervalMs: 8000,
    })
    const approved = await provider.pollToken(challenge)
    expect(approved.status).toBe('approved')
    if (approved.status === 'approved') {
      expect(approved.tokens.accessToken).toBe('atk')
      expect(approved.tokens.refreshToken).toBe('rtk')
      expect(approved.tokens.tokenType).toBe('Bearer')
    }
  })

  it('maps access_denied and expired_token', async () => {
    const providerDenied = createXaiOAuthProvider({
      clientId: 'test-client',
      fetch: async () => formResponse(400, { error: 'access_denied' }),
    })
    const providerExpired = createXaiOAuthProvider({
      clientId: 'test-client',
      fetch: async () => formResponse(400, { error: 'expired_token' }),
    })
    const challenge = {
      deviceCode: 'dev-1',
      userCode: 'CODE',
      verificationUri: 'https://accounts.x.ai/oauth2/device',
      expiresAt: Date.now() + 60_000,
      intervalMs: 5000,
    }
    await expect(providerDenied.pollToken(challenge)).resolves.toEqual({ status: 'denied' })
    await expect(providerExpired.pollToken(challenge)).resolves.toEqual({ status: 'expired' })
  })

  it('refreshes a token and fails loud on invalid_grant', async () => {
    const provider = createXaiOAuthProvider({
      clientId: 'test-client',
      fetch: async (_input, init) => {
        const body = String(init?.body ?? '')
        if (body.includes('grant_type=refresh_token') && body.includes('refresh_token=dead')) {
          return formResponse(400, { error: 'invalid_grant' })
        }
        return formResponse(200, {
          access_token: 'atk2',
          refresh_token: 'rtk2',
          expires_in: 1800,
          token_type: 'Bearer',
        })
      },
    })

    const next = await provider.refresh('live')
    expect(next.accessToken).toBe('atk2')
    expect(next.refreshToken).toBe('rtk2')

    await expect(provider.refresh('dead')).rejects.toMatchObject({
      code: 'INVALID_GRANT',
      provider: 'xai',
    })
  })
})
