import { describe, expect, it } from 'vitest'
import { createXaiSettingsApi } from './api.js'

describe('settings API client', () => {
  it('posts login and rejects a body that contains token fields', async () => {
    const api = createXaiSettingsApi(async () => new Response(JSON.stringify({
      state: 'pending',
      userCode: 'WDJB-MJHT',
      accessToken: 'nope',
    })))
    await expect(api.login()).rejects.toThrow(/token/i)
  })

  it('returns a public snapshot', async () => {
    const api = createXaiSettingsApi(async (input) => {
      expect(String(input)).toContain('/dsh-oauth/xai/status')
      return new Response(JSON.stringify({ state: 'logged_in' }))
    })
    await expect(api.status()).resolves.toEqual({ state: 'logged_in' })
  })
})
