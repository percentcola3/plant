export type DetectedProjectIde = 'cursor' | 'code' | 'none'
export type ProjectToolKind = 'finder' | 'cursor' | 'codex' | 'code'
export const DEFAULT_PROJECT_TOOL_KIND: ProjectToolKind = 'cursor'

export type ProjectToolMenuItem = {
  kind: ProjectToolKind
  label: string
  launchLabel: string
}

export function isProjectToolWorkspaceKind(kind: string | null | undefined): kind is 'project' | 'ux' {
  return kind === 'project' || kind === 'ux'
}

export function buildProjectToolMenuItems(detectedIde: DetectedProjectIde | null): ProjectToolMenuItem[] {
  void detectedIde
  return [
    { kind: 'cursor', label: 'Cursor', launchLabel: '正在打开 Cursor…' },
    { kind: 'finder', label: 'Finder', launchLabel: '正在打开 Finder…' },
    { kind: 'codex', label: 'Codex App', launchLabel: '正在准备 Codex App…' },
    { kind: 'code', label: 'VS Code', launchLabel: '正在打开 VS Code…' }
  ]
}

export function normalizeProjectToolKind(value: string | null | undefined): ProjectToolKind | null {
  if (value === 'finder' || value === 'cursor' || value === 'codex' || value === 'code') return value
  return null
}

export function findProjectToolMenuItem(
  items: ProjectToolMenuItem[],
  preferredKind: ProjectToolKind | null | undefined
): ProjectToolMenuItem | null {
  return items.find((item) => item.kind === preferredKind) ?? items[0] ?? null
}
