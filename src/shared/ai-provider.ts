export const AI_PROVIDERS = ['claude-code', 'deepseek-harness'] as const

export type AiProvider = typeof AI_PROVIDERS[number]

export const DEFAULT_AI_PROVIDER: AiProvider = 'claude-code'

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
}
