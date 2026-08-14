import type { StreamChunk } from './responses.js'
import type { HarnessGenerateOptions, HarnessToolSchema } from './serialize.js'

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  readonly tool_calls?: readonly ChatToolCall[]
  readonly tool_call_id?: string
}

export interface ChatToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

export interface ChatRequestBody {
  readonly model: string
  readonly stream: true
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly {
    readonly type: 'function'
    readonly function: {
      readonly name: string
      readonly description: string
      readonly parameters: Record<string, unknown>
    }
  }[]
  readonly temperature?: number
  readonly max_tokens?: number
  readonly reasoning_effort?: string
  readonly thinking?: { readonly type: 'enabled' | 'disabled' }
}

export function serializeChatRequest(options: HarnessGenerateOptions): ChatRequestBody {
  const tools = options.tools?.map((tool) => chatTool(tool))
  return {
    model: options.model,
    stream: true,
    messages: serializeChatMessages(options),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...thinkingFields(options.model, options.reasoningEffort),
  }
}

function chatTool(tool: HarnessToolSchema) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

export function serializeChatMessages(options: HarnessGenerateOptions): ChatMessage[] {
  const out: ChatMessage[] = []
  if (options.system) out.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    if (!isRecord(message)) continue
    const role = typeof message.role === 'string' ? message.role : 'user'
    const blocks = contentBlocks(message.content)
    if (role === 'system') {
      out.push({ role: 'system', content: flattenText(blocks) })
      continue
    }
    if (role === 'assistant') {
      const text = flattenText(blocks)
      const toolCalls = blocks.filter((block) => block.type === 'tool-call')
      const mapped = toolCalls.map((call) => ({
        id: stringField(call.id) || 'tool',
        type: 'function' as const,
        function: {
          name: stringField(call.name) || 'unknown',
          arguments: stringField(call.arguments),
        },
      }))
      out.push({
        role: 'assistant',
        content: text || (mapped.length > 0 ? null : ''),
        ...(mapped.length > 0 ? { tool_calls: mapped } : {}),
      })
      continue
    }
    const toolResults = blocks.filter((block) => block.type === 'tool-result')
    const text = flattenText(blocks)
    if (text.length > 0 || toolResults.length === 0) {
      out.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: stringField(result.toolCallId) || 'tool',
        content: flattenText(contentBlocks(result.content)) || '(no output)',
      })
    }
  }
  return out
}

function thinkingFields(
  model: string,
  effort: string | undefined,
): Pick<ChatRequestBody, 'reasoning_effort' | 'thinking'> {
  if (model === 'k3' || model.startsWith('k3-')) {
    if (!effort) return { reasoning_effort: 'high' }
    return { reasoning_effort: effort }
  }
  if (!effort || effort === 'off') return {}
  return { thinking: { type: 'enabled' } }
}

interface ContentBlock {
  readonly type?: string
  readonly text?: string
  readonly id?: string
  readonly name?: string
  readonly arguments?: string
  readonly toolCallId?: string
  readonly content?: unknown
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter((block): block is ContentBlock => isRecord(block))
}

function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('')
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function* translateChatSse(source: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let buffer = ''
  let usage: { inputTokens: number; outputTokens: number } | undefined
  let finished = false
  let nextIndex = 0
  let text: { index: number; text: string } | undefined
  const tools = new Map<number, { index: number; id: string; name: string; arguments: string }>()
  let finishKind: 'stop' | 'tool-calls' = 'stop'

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
    yield { type: 'finish', reason: { kind: tools.size > 0 || finishKind === 'tool-calls' ? 'tool-calls' : 'stop' } }
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
      const rawUsage = asObject(parsed.usage)
      if (rawUsage) {
        usage = {
          inputTokens: numberField(rawUsage, 'prompt_tokens'),
          outputTokens: numberField(rawUsage, 'completion_tokens'),
        }
      }
      const choices = Array.isArray(parsed.choices) ? parsed.choices : []
      const choice = asObject(choices[0])
      if (!choice) continue
      const reason = typeof choice.finish_reason === 'string' ? choice.finish_reason : ''
      if (reason === 'tool_calls') finishKind = 'tool-calls'
      const delta = asObject(choice.delta) ?? asObject(choice.message)
      if (!delta) continue
      const content = typeof delta.content === 'string' ? delta.content : ''
      if (content) {
        if (!text) {
          text = { index: nextIndex++, text: '' }
          yield { type: 'block-start', index: text.index, blockType: 'text' }
        }
        text.text += content
        yield { type: 'text-delta', text: content, index: text.index }
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
      for (const rawCall of toolCalls) {
        const call = asObject(rawCall)
        if (!call) continue
        const slot = typeof call.index === 'number' ? call.index : tools.size
        const fn = asObject(call.function)
        let tool = tools.get(slot)
        if (!tool) {
          tool = {
            index: nextIndex++,
            id: typeof call.id === 'string' && call.id ? call.id : `tool-${slot}`,
            name: typeof fn?.name === 'string' && fn.name ? fn.name : 'unknown',
            arguments: '',
          }
          tools.set(slot, tool)
          yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
        } else {
          if (typeof call.id === 'string' && call.id) tool.id = call.id
          if (typeof fn?.name === 'string' && fn.name) tool.name = fn.name
        }
        const argumentsDelta = typeof fn?.arguments === 'string' ? fn.arguments : ''
        if (argumentsDelta) {
          tool.arguments += argumentsDelta
          yield {
            type: 'tool-call-delta',
            id: tool.id,
            name: tool.name,
            argumentsDelta,
            index: tool.index,
          }
        }
      }
    }
  }
  yield* flush()
}

function extractSseEvents(buffer: string): { events: { data: string }[]; rest: string } {
  const events: { data: string }[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length > 0) events.push({ data: dataLines.join('\n') })
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
