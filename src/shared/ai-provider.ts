export const AI_PROVIDERS = ['claude-code', 'deepseek-harness', 'codex-cli', 'opencode-cli', 'pi-cli'] as const

export type AiProvider = typeof AI_PROVIDERS[number]

export const DEFAULT_AI_PROVIDER: AiProvider = 'claude-code'

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
}

export type CliAiProvider = Extract<AiProvider, 'codex-cli' | 'opencode-cli' | 'pi-cli'>
export function isCliAiProvider(value: unknown): value is CliAiProvider {
  return value === 'codex-cli' || value === 'opencode-cli' || value === 'pi-cli'
}
