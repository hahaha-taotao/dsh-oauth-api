import { describe, expect, it } from 'vitest'
import { collectChunks } from './responses.js'
import { serializeChatRequest, translateChatSse } from './chat.js'

describe('Kimi chat serialization', () => {
  it('flattens harness blocks into OpenAI chat messages', () => {
    const body = serializeChatRequest({
      provider: 'kimi-oauth',
      model: 'k3',
      system: 'You are Kimi',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
    })
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are Kimi' },
      { role: 'user', content: '你好' },
    ])
    expect(body.reasoning_effort).toBe('high')
    expect(body.stream).toBe(true)
  })

  it('maps assistant tool calls and tool results', () => {
    const body = serializeChatRequest({
      provider: 'kimi-oauth',
      model: 'kimi-for-coding',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"p":1}' },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
        },
      ],
    })
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"p":1}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ])
    expect(body.reasoning_effort).toBeUndefined()
  })
})

describe('Kimi chat SSE', () => {
  it('translates content and tool-call deltas', async () => {
    async function* source() {
      yield 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
      yield 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":"{"}}]}}]}\n\n'
      yield 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n'
      yield 'data: [DONE]\n\n'
    }
    const chunks = await collectChunks(translateChatSse(source()))
    expect(chunks.filter((chunk) => chunk.type === 'text-delta')).toEqual([
      { type: 'text-delta', text: 'hi', index: 0 },
    ])
    expect(chunks.some((chunk) => chunk.type === 'tool-call-delta' && chunk.argumentsDelta === '{')).toBe(true)
    expect(chunks.some((chunk) => chunk.type === 'usage' && chunk.usage.inputTokens === 2)).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })
})
