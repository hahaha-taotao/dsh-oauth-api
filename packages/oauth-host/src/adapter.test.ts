import { describe, expect, it } from 'vitest'
import { collectChunks, translateResponsesSse } from './responses.js'

describe('xAI Responses translator', () => {
  it('emits text deltas then usage before finish', async () => {
    const sse = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":" world"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2}}}',
      '',
    ].join('\n')

    const chunks = await collectChunks(translateResponsesSse(async function* () {
      yield sse
    }()))

    expect(chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text)).toEqual([
      'Hello',
      ' world',
    ])
    const usageIndex = chunks.findIndex((chunk) => chunk.type === 'usage')
    const finishIndex = chunks.findIndex((chunk) => chunk.type === 'finish')
    expect(usageIndex).toBeGreaterThan(-1)
    expect(finishIndex).toBeGreaterThan(usageIndex)
    expect(chunks.slice(finishIndex + 1)).toEqual([])
  })

  it('keeps tool-call arguments as a raw JSON string', async () => {
    const sse = [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"c1","name":"bash"}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"cmd\\":"}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"\\"ls\\"}"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n')

    const chunks = await collectChunks(translateResponsesSse(async function* () {
      yield sse
    }()))
    const args = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
    expect(args.map((chunk) => chunk.argumentsDelta).join('')).toBe('{"cmd":"ls"}')
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    expect(finish?.type === 'finish' && finish.reason.kind).toBe('tool-calls')
  })
})
