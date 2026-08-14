import { describe, expect, it } from 'vitest'
import { candidateProxyUrls } from './provider.ts'

describe('proxy candidates', () => {
  it('always includes the local Clash mixed port', () => {
    expect(candidateProxyUrls()).toContain('http://127.0.0.1:7890')
  })
})
