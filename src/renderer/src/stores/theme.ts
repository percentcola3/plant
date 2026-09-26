import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppTheme } from '@shared/app-theme'
import { DEFAULT_APP_THEME, isAppTheme } from '@shared/app-theme'
import { applyAppTheme } from '@/lib/app-theme'
import { call } from '@/lib/api'

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<AppTheme>(DEFAULT_APP_THEME)
  const ready = ref(false)

  async function initialize(): Promise<void> {
    const r = await call('settings.get', undefined)
    const next = r.ok && isAppTheme(r.data.theme) ? r.data.theme : DEFAULT_APP_THEME
    theme.value = next
    applyAppTheme(next)
    ready.value = true
  }

  async function setTheme(next: AppTheme): Promise<{ ok: true } | { ok: false; message: string }> {
    if (next === theme.value) return { ok: true }
    const r = await call('settings.update', { theme: next })
    if (!r.ok) return { ok: false, message: r.message }
    theme.value = r.data.theme ?? next
    applyAppTheme(theme.value)
    return { ok: true }
  }

  return { theme, ready, initialize, setTheme }
})
