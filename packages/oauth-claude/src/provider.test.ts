import { describe, expect, it } from 'vitest'
import { createClaudeOAuthProvider, parsePastedCode } from './provider.js'

describe('Claude PKCE provider', () => {
  it('builds an authorize URL and stays pending until a code is pasted', async () => {
    const provider = createClaudeOAuthProvider({
      fetch: async () => new Response('unused'),
    })
    const challenge = await provider.startDeviceCode()
    expect(provider.id).toBe('claude')
    expect(challenge.verificationUri).toContain('https://claude.ai/oauth/authorize')
    expect(challenge.verificationUri).toContain('code_challenge')
    expect(challenge.userCode).toBe('')
    await expect(provider.pollToken(challenge)).resolves.toEqual({ status: 'pending' })
  })

  it('exchanges a pasted authorization code', async () => {
    const provider = createClaudeOAuthProvider({
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: 'atk',
            refresh_token: 'rtk',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    })
    const challenge = await provider.startDeviceCode()
    await provider.completeAuthorization(`acode#${challenge.deviceCode}`)
    const approved = await provider.pollToken(challenge)
    expect(approved).toMatchObject({
      status: 'approved',
      tokens: { accessToken: 'atk', refreshToken: 'rtk' },
    })
  })

  it('splits Claude callback code#state', () => {
    expect(parsePastedCode('abc#xyz')).toEqual({ code: 'abc', state: 'xyz' })
  })
})
