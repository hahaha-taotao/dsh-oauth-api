import { describe, expect, it } from 'vitest'
import { chatgptAccountId, createCodexOAuthProvider } from './provider.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Codex device-code provider', () => {
  it('starts a device-code challenge and maps pending 403 polls', async () => {
    const seen: string[] = []
    const provider = createCodexOAuthProvider({
      fetch: async (input) => {
        const url = String(input)
        seen.push(url)
        if (url.endsWith('/usercode')) {
          return jsonResponse(200, {
            user_code: 'V0SZ-CL1Y',
            device_auth_id: 'dev-1',
            interval: 5,
          })
        }
        if (url.endsWith('/deviceauth/token')) return jsonResponse(403, {})
        throw new Error(`unexpected ${url}`)
      },
    })

    const challenge = await provider.startDeviceCode()
    expect(provider.id).toBe('codex')
    expect(challenge.userCode).toBe('V0SZ-CL1Y')
    expect(challenge.deviceCode).toBe('dev-1')
    expect(challenge.verificationUri).toBe('https://auth.openai.com/codex/device')
    await expect(provider.pollToken(challenge)).resolves.toEqual({ status: 'pending' })
    expect(seen.some((url) => url.includes('/usercode'))).toBe(true)
  })

  it('exchanges authorization_code after approval', async () => {
    const provider = createCodexOAuthProvider({
      fetch: async (input) => {
        const url = String(input)
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, {
            access_token: 'atk',
            refresh_token: 'rtk',
            expires_in: 3600,
            token_type: 'Bearer',
          })
        }
        return jsonResponse(200, {
          authorization_code: 'acode',
          code_verifier: 'verifier',
        })
      },
    })

    const approved = await provider.pollToken({
      deviceCode: 'dev-1',
      userCode: 'CODE',
      verificationUri: 'https://auth.openai.com/codex/device',
      expiresAt: Date.now() + 60_000,
      intervalMs: 5000,
    })
    expect(approved).toEqual({
      status: 'approved',
      tokens: {
        accessToken: 'atk',
        refreshToken: 'rtk',
        expiresAt: expect.any(Number),
        tokenType: 'Bearer',
      },
    })
  })

  it('reads chatgpt_account_id from a JWT without logging it', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${encode({ alg: 'none' })}.${encode({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' },
    })}.sig`
    expect(chatgptAccountId(token)).toBe('acct_1')
  })
})
