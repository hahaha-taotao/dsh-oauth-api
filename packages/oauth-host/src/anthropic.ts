import type { StreamChunk } from './responses.js'
import type { HarnessGenerateOptions } from './serialize.js'

export function serializeAnthropicRequest(options: HarnessGenerateOptions): Record<string, unknown> {
  const tools = options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
  const thinking = thinkingFor(options.reasoningEffort)
  const maxTokens = Math.max(options.maxTokens ?? 16_000, thinking ? thinking.budget_tokens + 1024 : 1)
  return {
    model: options.model,
    stream: true,
    max_tokens: maxTokens,
    messages: serializeAnthropicMessages(options.messages),
    ...(options.system ? { system: options.system } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(thinking ? { thinking } : {}),
  }
}

function thinkingFor(effort: string | undefined): { type: 'enabled'; budget_tokens: number } | undefined {
  if (!effort || effort === 'off') return undefined
  if (effort === 'low') return { type: 'enabled', budget_tokens: 4_000 }
  if (effort === 'medium') return { type: 'enabled', budget_tokens: 10_000 }
  return { type: 'enabled', budget_tokens: 16_000 }
}

function serializeAnthropicMessages(messages: readonly unknown[]): unknown[] {
  const out: unknown[] = []
  for (const message of messages) {
    if (!isRecord(message)) continue
    const role = typeof message.role === 'string' ? message.role : 'user'
    const blocks = Array.isArray(message.content) ? message.content.filter(isRecord) : []
    if (role === 'assistant') {
      const content: unknown[] = []
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') content.push({ type: 'text', text: block.text })
        if (block.type === 'tool-call') {
          content.push({
            type: 'tool_use',
            id: typeof block.id === 'string' ? block.id : 'tool',
            name: typeof block.name === 'string' ? block.name : 'unknown',
            input: parseJson(typeof block.arguments === 'string' ? block.arguments : '{}'),
          })
        }
      }
      out.push({ role: 'assistant', content: content.length > 0 ? content : '' })
      continue
    }
    const toolResults = blocks.filter((block) => block.type === 'tool-result')
    const text = blocks
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => String(block.text))
      .join('')
    if (text || toolResults.length === 0) out.push({ role: 'user', content: text })
    for (const result of toolResults) {
      const inner = Array.isArray(result.content) ? result.content.filter(isRecord) : []
      const output = inner
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => String(block.text))
        .join('') || '(no output)'
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: typeof result.toolCallId === 'string' ? result.toolCallId : 'tool',
            content: output,
          },
        ],
      })
    }
  }
  return out
}

export async function* translateAnthropicSse(source: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let buffer = ''
  let nextIndex = 0
  let text: { index: number; text: string } | undefined
  const tools = new Map<number, { index: number; id: string; name: string; arguments: string }>()
  let usage: { inputTokens: number; outputTokens: number } | undefined
  let finished = false

  const flush = function* flushPending(): Generator<StreamChunk> {
    if (finished) return
    if (text) yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.text } }
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
    const events = extractSse(buffer)
    buffer = events.rest
    for (const event of events.events) {
      const parsed = parseObject(event.data)
      if (!parsed) continue
      const type = typeof parsed.type === 'string' ? parsed.type : event.event
      if (type === 'content_block_delta') {
        const delta = isRecord(parsed.delta) ? parsed.delta : undefined
        const index = typeof parsed.index === 'number' ? parsed.index : 0
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
          if (!text) {
            text = { index: nextIndex++, text: '' }
            yield { type: 'block-start', index: text.index, blockType: 'text' }
          }
          text.text += delta.text
          yield { type: 'text-delta', text: delta.text, index: text.index }
        }
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const tool = tools.get(index)
          if (tool && delta.partial_json) {
            tool.arguments += delta.partial_json
            yield {
              type: 'tool-call-delta',
              id: tool.id,
              name: tool.name,
              argumentsDelta: delta.partial_json,
              index: tool.index,
            }
          }
        }
        continue
      }
      if (type === 'content_block_start') {
        const block = isRecord(parsed.content_block) ? parsed.content_block : undefined
        const outputIndex = typeof parsed.index === 'number' ? parsed.index : tools.size
        if (block?.type === 'tool_use') {
          const tool = {
            index: nextIndex++,
            id: typeof block.id === 'string' ? block.id : 'tool',
            name: typeof block.name === 'string' ? block.name : 'unknown',
            arguments: '',
          }
          tools.set(outputIndex, tool)
          yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
        }
        continue
      }
      if (type === 'message_delta') {
        const rawUsage = isRecord(parsed.usage) ? parsed.usage : undefined
        if (rawUsage) {
          usage = {
            inputTokens: typeof rawUsage.input_tokens === 'number' ? rawUsage.input_tokens : usage?.inputTokens ?? 0,
            outputTokens: typeof rawUsage.output_tokens === 'number' ? rawUsage.output_tokens : 0,
          }
        }
        continue
      }
      if (type === 'message_stop') {
        yield* flush()
        return
      }
    }
  }
  yield* flush()
}

function extractSse(buffer: string): { events: { event?: string; data: string }[]; rest: string } {
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

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
