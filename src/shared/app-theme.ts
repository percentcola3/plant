export const APP_THEMES = ['dark', 'light'] as const

export type AppTheme = typeof APP_THEMES[number]

export const DEFAULT_APP_THEME: AppTheme = 'light'

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (APP_THEMES as readonly string[]).includes(value)
}
