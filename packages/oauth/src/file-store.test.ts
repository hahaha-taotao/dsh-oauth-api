import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileTokenStore } from './file-store.js'
import { STORE_VERSION, type StoredSession } from './types.js'

function sample(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    version: STORE_VERSION,
    provider: 'xai',
    accessToken: 'atk',
    refreshToken: 'rtk',
    expiresAt: Date.now() + 60_000,
    tokenType: 'Bearer',
    refreshDead: false,
    ...overrides,
  }
}

describe('file token store', () => {
  it('round-trips a session and ignores a planted ~/.grok/auth.json sibling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-'))
    const grokCli = join(dir, '..', 'auth.json')
    await writeFile(join(dir, 'planted-grok.json'), '{"access_token":"cli-secret"}', 'utf8')
    const store = createFileTokenStore(dir)

    expect(await store.read('xai')).toBeUndefined()
    await store.write(sample())
    const loaded = await store.read('xai')
    expect(loaded?.accessToken).toBe('atk')
    expect(loaded?.refreshToken).toBe('rtk')

    const raw = await readFile(join(dir, 'xai.json'), 'utf8')
    expect(raw).toContain('atk')
    expect(raw).not.toContain('cli-secret')
    void grokCli
  })

  it('clears only the named provider file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-'))
    const store = createFileTokenStore(dir)
    await store.write(sample())
    await store.write(sample({ provider: 'other', accessToken: 'other-atk' }))
    await store.clear('xai')
    expect(await store.read('xai')).toBeUndefined()
    expect((await store.read('other'))?.accessToken).toBe('other-atk')
  })

  it('rejects an unknown store version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-'))
    await writeFile(join(dir, 'xai.json'), JSON.stringify({ version: 99, provider: 'xai' }), 'utf8')
    const store = createFileTokenStore(dir)
    await expect(store.read('xai')).rejects.toMatchObject({ code: 'STORE_VERSION' })
  })
})
