export const CLI_KINDS = ['claude', 'dcc'] as const

export type CliKind = typeof CLI_KINDS[number]

export const DEFAULT_CLI_KIND: CliKind = 'dcc'
