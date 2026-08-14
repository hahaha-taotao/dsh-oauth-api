import { describe, expect, it } from 'vitest'
import { serializeResponsesRequest } from './serialize.js'

describe('serializeResponsesRequest', () => {
  it('flattens harness content blocks into xAI Responses input strings', () => {
    const body = serializeResponsesRequest({
      provider: 'xai-oauth',
      model: 'grok-4.6',
      system: 'You are Grok',
      messages: [
        {
          id: 'm1',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: '你好' }],
        },
      ],
      tools: [
        {
          name: 'bash',
          description: 'run a command',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })

    expect(body).toEqual({
      model: 'grok-4.6',
      stream: true,
      store: false,
      input: [{ role: 'user', content: '你好' }],
      instructions: 'You are Grok',
      tools: [
        {
          type: 'function',
          name: 'bash',
          description: 'run a command',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })
    expect(JSON.stringify(body.input)).not.toContain('"type":"text"')
  })

  it('maps harness reasoningEffort onto Responses reasoning.effort', () => {
    const body = serializeResponsesRequest({
      provider: 'xai-oauth',
      model: 'grok-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'xhigh',
    })
    expect(body.reasoning).toEqual({ effort: 'xhigh' })
  })

  it('maps assistant tool calls and tool results to Responses items', () => {
    const body = serializeResponsesRequest({
      provider: 'xai-oauth',
      model: 'grok-4.6',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling' },
            { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
        },
      ],
    })

    expect(body.input).toEqual([
      { role: 'assistant', content: 'calling' },
      { type: 'function_call', call_id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'ok' },
    ])
  })
})
