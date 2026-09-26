import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from './ui'

describe('ui store git operation dialogs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('closes AI repair prompt and sync progress together', () => {
    const ui = useUiStore()
    ui.openSyncProgress('workspace-1', 'save current progress', 'remote')
    ui.openAiRepairPrompt({
      title: '同步 Git 状态',
      message: '同步没有完成。',
      prompt: '请检查 Git 状态'
    })

    ui.closeGitOperationDialogs()

    expect(ui.aiRepairPrompt).toBeNull()
    expect(ui.syncProgress).toBeNull()
  })

  it('opens settings on a requested tab', () => {
    const ui = useUiStore()

    ui.openSettings('ssh')

    expect(ui.settingsOpen).toBe(true)
    expect(ui.settingsInitialTab).toBe('ssh')
  })

  it('toggles AI task lane panel', () => {
    const ui = useUiStore()

    ui.openAiTaskPanel()
    expect(ui.aiTaskPanelOpen).toBe(true)

    ui.closeAiTaskPanel()
    expect(ui.aiTaskPanelOpen).toBe(false)
  })
})
