import { describe, expect, it } from 'vitest'
import { reasoningForModel } from './reasoning.js'

describe('xAI reasoning efforts', () => {
  it('advertises xhigh only on grok-4.6', () => {
    expect(reasoningForModel('grok-4.6').efforts.map((effort) => effort.id)).toContain('xhigh')
    expect(reasoningForModel('grok-4.5').efforts.map((effort) => effort.id)).not.toContain('xhigh')
    expect(reasoningForModel('grok-4.6').defaultEffort).toBe('high')
  })

  it('lets grok-4.3 turn reasoning off', () => {
    expect(reasoningForModel('grok-4.3').efforts.map((effort) => effort.id)).toContain('none')
  })
})
