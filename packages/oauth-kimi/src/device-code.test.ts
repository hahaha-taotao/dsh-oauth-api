import { describe, expect, it } from 'vitest'
import { createKimiOAuthProvider, DEFAULT_KIMI_CLIENT_ID } from './provider.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Kimi device-code provider', () => {
  it('starts a device-code challenge against auth.kimi.com', async () => {
    const seen: { url: string; body: string }[] = []
    const provider = createKimiOAuthProvider({
      fetch: async (input, init) => {
        seen.push({ url: String(input), body: String(init?.body ?? '') })
        return jsonResponse(200, {
          device_code: 'dev-1',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://auth.kimi.com/device',
          verification_uri_complete: 'https://auth.kimi.com/device?user_code=WDJB-MJHT',
          expires_in: 900,
          interval: 5,
        })
      },
    })

    const challenge = await provider.startDeviceCode()
    expect(provider.id).toBe('kimi')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://auth.kimi.com/api/oauth/device_authorization')
    expect(seen[0].body).toContain(`client_id=${DEFAULT_KIMI_CLIENT_ID}`)
    expect(challenge.userCode).toBe('WDJB-MJHT')
    expect(challenge.deviceCode).toBe('dev-1')
    expect(challenge.verificationUriComplete).toBe('https://auth.kimi.com/device?user_code=WDJB-MJHT')
    expect(challenge.intervalMs).toBe(5000)
  })

  it('maps authorization_pending and exchanges tokens after approval', async () => {
    const replies = [
      { status: 400, body: { error: 'authorization_pending' } },
      {
        status: 200,
        body: {
          access_token: 'atk',
          refresh_token: 'rtk',
          expires_in: 900,
          token_type: 'Bearer',
          scope: 'kimi-code',
        },
      },
    ]
    const provider = createKimiOAuthProvider({
      fetch: async () => {
        const next = replies.shift()
        if (!next) throw new Error('unexpected extra poll')
        return jsonResponse(next.status, next.body)
      },
    })
    const challenge = {
      deviceCode: 'dev-1',
      userCode: 'CODE',
      verificationUri: 'https://auth.kimi.com/device',
      expiresAt: Date.now() + 60_000,
      intervalMs: 1000,
    }
    await expect(provider.pollToken(challenge)).resolves.toEqual({ status: 'pending' })
    const approved = await provider.pollToken(challenge)
    expect(approved).toMatchObject({
      status: 'approved',
      tokens: { accessToken: 'atk', refreshToken: 'rtk', tokenType: 'Bearer', scope: 'kimi-code' },
    })
  })

  it('maps invalid_grant on refresh', async () => {
    const provider = createKimiOAuthProvider({
      fetch: async () => jsonResponse(400, { error: 'invalid_grant' }),
    })
    await expect(provider.refresh('dead')).rejects.toMatchObject({ code: 'INVALID_GRANT' })
  })
})
