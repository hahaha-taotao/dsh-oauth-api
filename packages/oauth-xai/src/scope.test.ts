import { describe, expect, it } from 'vitest'
import { DEFAULT_XAI_SCOPE, accessTokenGrantsXaiApi, hasXaiApiAccessScope } from './scope.js'

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

describe('xAI api:access scope', () => {
  it('is part of the default Family A scope', () => {
    expect(hasXaiApiAccessScope(DEFAULT_XAI_SCOPE)).toBe(true)
  })

  it('rejects OAuth JWTs that only have grok-cli:access', () => {
    const token = fakeJwt({ scope: 'openid offline_access grok-cli:access' })
    expect(accessTokenGrantsXaiApi(token)).toBe(false)
  })

  it('accepts OAuth JWTs and opaque API keys', () => {
    expect(accessTokenGrantsXaiApi(fakeJwt({ scope: DEFAULT_XAI_SCOPE }))).toBe(true)
    expect(accessTokenGrantsXaiApi('xai-plain-api-key')).toBe(true)
  })
})
