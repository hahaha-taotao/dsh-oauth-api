import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('browser client bundle', () => {
  it('registers a ModuleLoader factory and a settings.section login button', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'browser.js'), 'utf8')
    expect(source).toContain('window.__ModuleLoader__.load')
    expect(source).toContain("id: '@dsh-plugin/oauth-client'")
    expect(source).toContain("name: 'settings.section'")
    expect(source).toContain("inject: ['slots']")
    expect(source).toContain('登录')
    expect(source).toContain('OAuth 登录')
    expect(source).toContain("id: 'codex'")
    expect(source).toContain("id: 'claude'")
    expect(source).toContain('host leaked token fields')
  })
})
