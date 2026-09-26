import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('./AiRepairPromptDialog.vue', import.meta.url),
  'utf-8'
)

describe('AI repair prompt dialog', () => {
  it('closes git operation dialogs after copying and opening AI chat', () => {
    expect(source).toContain('ui.openTerminalPanel()')
    expect(source).toContain('ui.closeGitOperationDialogs()')
  })
})
