import { describe, expect, it } from 'vitest'
import { shouldShowTerminalPane } from './terminal-panel-visibility'

describe('shouldShowTerminalPane', () => {
  it('hides the AI panel while a branch checkout is in progress', () => {
    expect(shouldShowTerminalPane({
      previewActive: true,
      editorOpen: false,
      terminalPanelOpen: true,
      branchSwitching: true
    })).toBe(false)

    expect(shouldShowTerminalPane({
      previewActive: false,
      editorOpen: true,
      terminalPanelOpen: false,
      branchSwitching: true
    })).toBe(false)
  })

  it('shows the AI panel from preview, editor, or manual open when branches are stable', () => {
    expect(shouldShowTerminalPane({
      previewActive: true,
      editorOpen: false,
      terminalPanelOpen: false,
      branchSwitching: false
    })).toBe(true)
    expect(shouldShowTerminalPane({
      previewActive: false,
      editorOpen: true,
      terminalPanelOpen: false,
      branchSwitching: false
    })).toBe(true)
    expect(shouldShowTerminalPane({
      previewActive: false,
      editorOpen: false,
      terminalPanelOpen: true,
      branchSwitching: false
    })).toBe(true)
  })
})
