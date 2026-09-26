import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/index.css'
import { call } from './lib/api'
import { applyAppTheme } from './lib/app-theme'
import { DEFAULT_APP_THEME } from '@shared/app-theme'
import { useThemeStore } from './stores/theme'

function rendererErrorPayload(kind: 'error' | 'unhandledrejection', value: unknown) {
  const error = value instanceof Error ? value : new Error(String(value))
  return {
    kind,
    name: error.name,
    message: error.message,
    stack: error.stack
  }
}

window.addEventListener('error', (event) => {
  void call('diagnostics.reportRendererError', rendererErrorPayload('error', event.error ?? event.message))
})

window.addEventListener('unhandledrejection', (event) => {
  void call('diagnostics.reportRendererError', rendererErrorPayload('unhandledrejection', event.reason))
})

async function bootstrap(): Promise<void> {
  applyAppTheme(DEFAULT_APP_THEME)
  const pinia = createPinia()
  const app = createApp(App)
  app.use(pinia)
  await useThemeStore(pinia).initialize()
  app.mount('#app')
}

void bootstrap()
