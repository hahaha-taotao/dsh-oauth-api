export type StreamChunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: 'text' | 'tool-call' }
  | { readonly type: 'text-delta'; readonly text: string; readonly index: number }
  | {
      readonly type: 'tool-call-delta'
      readonly id: string
      readonly name?: string
      readonly argumentsDelta: string
      readonly index: number
    }
  | {
      readonly type: 'block-end'
      readonly index: number
      readonly block:
        | { readonly type: 'text'; readonly text: string }
        | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
    }
  | { readonly type: 'usage'; readonly usage: { readonly inputTokens: number; readonly outputTokens: number } }
  | {
      readonly type: 'finish'
      readonly reason:
        | { readonly kind: 'stop' | 'tool-calls' }
        | { readonly kind: 'error'; readonly failure: { readonly code: string; readonly message: string } }
    }

export async function collectChunks(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

export async function* translateResponsesSse(
  source: AsyncIterable<string>,
): AsyncGenerator<StreamChunk> {
  let buffer = ''
  let usage: { inputTokens: number; outputTokens: number } | undefined
  let finished = false
  let nextIndex = 0
  let text: { index: number; text: string } | undefined
  const tools = new Map<number, { index: number; id: string; name: string; arguments: string }>()

  const flush = function* flushPending(): Generator<StreamChunk> {
    if (finished) return
    if (text) {
      yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.text } }
    }
    for (const tool of tools.values()) {
      yield {
        type: 'block-end',
        index: tool.index,
        block: { type: 'tool-call', id: tool.id, name: tool.name, arguments: tool.arguments },
      }
    }
    if (usage) yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: tools.size > 0 ? 'tool-calls' : 'stop' } }
    finished = true
  }

  for await (const piece of source) {
    buffer += piece
    const events = extractSseEvents(buffer)
    buffer = events.rest
    for (const event of events.events) {
      if (event.data === '[DONE]') {
        yield* flush()
        return
      }
      const parsed = parseJson(event.data)
      if (!parsed) continue
      const type = typeof parsed.type === 'string' ? parsed.type : event.event
      if (type === 'response.output_text.delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
        if (!delta) continue
        if (!text) {
          text = { index: nextIndex++, text: '' }
          yield { type: 'block-start', index: text.index, blockType: 'text' }
        }
        text.text += delta
        yield { type: 'text-delta', text: delta, index: text.index }
        continue
      }
      if (type === 'response.output_item.added') {
        const item = asObject(parsed.item)
        if (item?.type === 'function_call') {
          const outputIndex = typeof parsed.output_index === 'number' ? parsed.output_index : tools.size
          const id = stringField(item.call_id) || stringField(item.id) || 'tool'
          const name = stringField(item.name) || 'unknown'
          const args = stringField(item.arguments)
          const tool = { index: nextIndex++, id, name, arguments: args }
          tools.set(outputIndex, tool)
          yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
          if (args) {
            yield { type: 'tool-call-delta', id, name, argumentsDelta: args, index: tool.index }
          }
        }
        continue
      }
      if (type === 'response.function_call_arguments.delta') {
        const outputIndex = typeof parsed.output_index === 'number' ? parsed.output_index : 0
        const argumentsDelta = typeof parsed.delta === 'string' ? parsed.delta : ''
        const tool = tools.get(outputIndex)
        if (!tool || !argumentsDelta) continue
        tool.arguments += argumentsDelta
        yield {
          type: 'tool-call-delta',
          id: tool.id,
          name: tool.name,
          argumentsDelta,
          index: tool.index,
        }
        continue
      }
      if (type === 'response.completed') {
        const response = asObject(parsed.response)
        const rawUsage = asObject(response?.usage)
        if (rawUsage) {
          usage = {
            inputTokens: numberField(rawUsage, 'input_tokens'),
            outputTokens: numberField(rawUsage, 'output_tokens'),
          }
        }
        yield* flush()
        return
      }
    }
  }
  if (buffer.trim()) {
    const tail = extractSseEvents(`${buffer}\n\n`)
    for (const event of tail.events) {
      if (event.data === '[DONE]') {
        yield* flush()
        return
      }
      const parsed = parseJson(event.data)
      if (!parsed) continue
      const type = typeof parsed.type === 'string' ? parsed.type : event.event
      if (type === 'response.completed') {
        const response = asObject(parsed.response)
        const rawUsage = asObject(response?.usage)
        if (rawUsage) {
          usage = {
            inputTokens: numberField(rawUsage, 'input_tokens'),
            outputTokens: numberField(rawUsage, 'output_tokens'),
          }
        }
      }
    }
  }
  yield* flush()
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractSseEvents(buffer: string): { events: { event?: string; data: string }[]; rest: string } {
  const events: { event?: string; data: string }[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event: string | undefined
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length > 0) events.push({ ...(event ? { event } : {}), data: dataLines.join('\n') })
  }
  return { events, rest }
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return asObject(value)
  } catch {
    return undefined
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
