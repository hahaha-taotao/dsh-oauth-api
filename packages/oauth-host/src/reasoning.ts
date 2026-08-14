export interface ReasoningEffortInfo {
  readonly id: string
  readonly name: string
}

export interface ModelReasoningInfo {
  readonly efforts: readonly ReasoningEffortInfo[]
  readonly defaultEffort: string
}

const LOW = { id: 'low', name: 'Low' } as const
const MEDIUM = { id: 'medium', name: 'Medium' } as const
const HIGH = { id: 'high', name: 'High' } as const
const XHIGH = { id: 'xhigh', name: 'Xhigh' } as const
const NONE = { id: 'none', name: 'Off' } as const

/** xAI Responses `reasoning.effort` by model. grok-4.6 cannot disable reasoning. */
const MODEL_REASONING: Record<string, ModelReasoningInfo> = {
  'grok-4.6': { efforts: [LOW, MEDIUM, HIGH, XHIGH], defaultEffort: HIGH.id },
  'grok-4.5': { efforts: [LOW, MEDIUM, HIGH], defaultEffort: HIGH.id },
  'grok-4.3': { efforts: [NONE, LOW, MEDIUM, HIGH], defaultEffort: HIGH.id },
  'grok-build-0.1': { efforts: [LOW, MEDIUM, HIGH], defaultEffort: HIGH.id },
}

export function reasoningForModel(model: string): ModelReasoningInfo {
  return MODEL_REASONING[model] ?? MODEL_REASONING['grok-4.6']
}
