import { validatePeekaConnection } from '../../../shared/peeka'
import { findAiTaskNotchWindow, presentAiTaskNotch } from '../../ai-tasks/notch-window'
import { isAbsolute } from 'node:path'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { settingsStore } from '../../settings/store'
import type { AppSettings, CliKind, ProjectToolKind } from '../../settings/store'
import { probeClaudeCapabilities, resetClaudeCapabilitiesCache } from '../../claude-headless/capability-probe'
import { deepSeekCredentialStore } from '../../deepseek-harness/credentials'
import { isAiProvider } from '../../../shared/ai-provider'

const VALID_TOOLS = new Set<string>(['finder', 'terminal', 'codex', 'cursor', 'code'])
const VALID_CLI_KINDS = new Set<string>(['claude', 'dcc'])

export function registerSettingsHandlers(): void {
  registerIpcHandler('settings.get', async () => settingsView(await settingsStore.get()))

  registerIpcHandler('settings.update', async ({ workspaceRoot, preferredTool, cliKind, aiProvider, deepseekApiKey, peekaConnection, aiTaskNotchEnabled, defaultExternalRefIds, theme }) => {
    const current = await settingsStore.get()
    const patch: Partial<AppSettings> = {}
    let keyConfigured = await deepSeekCredentialStore.hasApiKey()

    if (peekaConnection !== undefined) {
      try { patch.peekaConnection = validatePeekaConnection(peekaConnection) }
      catch (error) { throw new UIClientError('VALIDATION', (error as Error).message) }
      if (patch.peekaConnection.baseUrl !== current.peekaConnection.baseUrl && keyConfigured && !deepseekApiKey?.trim()) {
        throw new UIClientError('VALIDATION', '切换请求地址时请重新输入对应的 API key')
      }
    }
    if (aiTaskNotchEnabled !== undefined) {
      if (typeof aiTaskNotchEnabled !== 'boolean') throw new UIClientError('VALIDATION', '悬浮任务球开关无效')
      patch.aiTaskNotchEnabled = aiTaskNotchEnabled
    }

    if (deepseekApiKey !== undefined) {
      if (deepseekApiKey === null) {
        await deepSeekCredentialStore.clearApiKey()
        keyConfigured = false
        if (current.aiProvider === 'deepseek-harness' && aiProvider === undefined) {
          patch.aiProvider = 'claude-code'
          patch.cliKind = 'dcc'
        }
      } else {
        const cleaned = deepseekApiKey.trim()
        if (!cleaned) throw new UIClientError('VALIDATION', 'DeepSeek API key 不能为空')
        await deepSeekCredentialStore.setApiKey(cleaned)
        keyConfigured = true
      }
    }

    if (aiProvider !== undefined) {
      if (!isAiProvider(aiProvider)) {
        throw new UIClientError('VALIDATION', `aiProvider 无效：${aiProvider}`)
      }
      if (aiProvider === 'deepseek-harness' && !keyConfigured) {
        throw new UIClientError('DEEPSEEK_KEY_REQUIRED', '请先配置 DeepSeek API key')
      }
      patch.aiProvider = aiProvider
      if (aiProvider === 'claude-code') {
        resetClaudeCapabilitiesCache()
        void probeClaudeCapabilities().catch((error) => {
          console.warn('[settings] Claude capability probe failed:', error)
        })
      }
    }
    if (workspaceRoot !== undefined) {
      const cleaned = workspaceRoot.trim()
      if (!cleaned || !isAbsolute(cleaned)) {
        throw new UIClientError('VALIDATION', 'workspaceRoot 必须是绝对路径')
      }
      patch.workspaceRoot = cleaned
    }
    if (preferredTool !== undefined) {
      if (!VALID_TOOLS.has(preferredTool)) {
        throw new UIClientError('VALIDATION', `preferredTool 无效：${preferredTool}`)
      }
      patch.preferredTool = preferredTool as ProjectToolKind
    }
    if (cliKind !== undefined) {
      if (!VALID_CLI_KINDS.has(cliKind)) {
        throw new UIClientError('VALIDATION', `cliKind 无效：${cliKind}`)
      }
      patch.cliKind = cliKind as CliKind
      // 切 CLI 后老的 capability cache 是另一二进制的能力，必须丢掉重探一次
      resetClaudeCapabilitiesCache()
    }
    if (defaultExternalRefIds !== undefined) {
      if (!Array.isArray(defaultExternalRefIds) || defaultExternalRefIds.some((id) => typeof id !== 'string')) {
        throw new UIClientError('VALIDATION', 'defaultExternalRefIds 必须是字符串数组')
      }
      patch.defaultExternalRefIds = [...new Set(defaultExternalRefIds.map((id) => id.trim()).filter(Boolean))]
    }
    if (theme !== undefined) {
      if (theme !== 'dark' && theme !== 'light') {
        throw new UIClientError('VALIDATION', `theme 无效：${theme}`)
      }
      patch.theme = theme
    }
    const saved = Object.keys(patch).length > 0 ? await settingsStore.update(patch) : current
    if (aiTaskNotchEnabled !== undefined) {
      if (aiTaskNotchEnabled) presentAiTaskNotch()
      else findAiTaskNotchWindow()?.hide()
    }
    return { ...saved, deepseekApiKeyConfigured: keyConfigured }
  })
}

async function settingsView(settings: AppSettings): Promise<AppSettings & { deepseekApiKeyConfigured: boolean }> {
  return {
    ...settings,
    deepseekApiKeyConfigured: await deepSeekCredentialStore.hasApiKey()
  }
}
