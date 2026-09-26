import type { AppTheme } from '@shared/app-theme'

export function applyAppTheme(theme: AppTheme): void {
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
}
