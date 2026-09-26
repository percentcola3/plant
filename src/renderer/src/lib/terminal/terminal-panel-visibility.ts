export type TerminalPaneVisibilityInput = {
  previewActive: boolean
  editorOpen: boolean
  terminalPanelOpen: boolean
  branchSwitching: boolean
}

export function shouldShowTerminalPane(input: TerminalPaneVisibilityInput): boolean {
  if (input.branchSwitching) return false
  return input.previewActive || input.editorOpen || input.terminalPanelOpen
}
