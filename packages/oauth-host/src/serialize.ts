export interface HarnessToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export interface HarnessGenerateOptions {
  readonly provider: string
  readonly model: string
  readonly system?: string
  readonly messages: readonly unknown[]
  readonly tools?: readonly HarnessToolSchema[]
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
  readonly reasoningEffort?: string
  readonly signal?: AbortSignal
}

export type ResponsesInputItem =
  | { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }
  | {
      readonly type: 'function_call'
      readonly call_id: string
      readonly name: string
      readonly arguments: string
    }
  | {
      readonly type: 'function_call_output'
      readonly call_id: string
      readonly output: string
    }

export interface ResponsesRequestBody {
  readonly model: string
  readonly stream: true
  readonly store: false
  readonly input: readonly ResponsesInputItem[]
  readonly instructions?: string
  readonly tools?: readonly ResponsesTool[]
  readonly temperature?: number
  readonly max_output_tokens?: number
  readonly reasoning?: { readonly effort: string }
}

export interface ResponsesTool {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
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

export function serializeResponsesRequest(options: HarnessGenerateOptions): ResponsesRequestBody {
  const tools = options.tools?.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
  return {
    model: options.model,
    stream: true,
    store: false,
    input: serializeInput(options.messages),
    ...(options.system ? { instructions: options.system } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { max_output_tokens: options.maxTokens } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
  }
}

export function serializeInput(messages: readonly unknown[]): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = []
  for (const message of messages) {
    if (!isRecord(message)) continue
    const role = typeof message.role === 'string' ? message.role : 'user'
    const blocks = contentBlocks(message.content)
    if (role === 'system') {
      input.push({ role: 'system', content: flattenText(blocks) })
      continue
    }
    if (role === 'assistant') {
      const text = flattenText(blocks)
      const toolCalls = blocks.filter((block) => block.type === 'tool-call')
      if (text.length > 0 || toolCalls.length === 0) {
        input.push({ role: 'assistant', content: text })
      }
      for (const call of toolCalls) {
        input.push({
          type: 'function_call',
          call_id: stringField(call.id) || 'tool',
          name: stringField(call.name) || 'unknown',
          arguments: stringField(call.arguments),
        })
      }
      continue
    }
    const toolResults = blocks.filter((block) => block.type === 'tool-result')
    const text = flattenText(blocks)
    if (text.length > 0 || toolResults.length === 0) {
      input.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      input.push({
        type: 'function_call_output',
        call_id: stringField(result.toolCallId) || 'tool',
        output: flattenText(contentBlocks(result.content)) || '(no output)',
      })
    }
  }
  return input
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
