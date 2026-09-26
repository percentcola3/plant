export const CLI_KINDS = ['claude'] as const

export type CliKind = typeof CLI_KINDS[number]

export const DEFAULT_CLI_KIND: CliKind = 'claude'
