import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_TOOL_KIND,
  buildProjectToolMenuItems,
  findProjectToolMenuItem,
  isProjectToolWorkspaceKind,
  normalizeProjectToolKind
} from './project-tool-menu'

describe('project tool menu', () => {
  it('offers the supported project open targets', () => {
    expect(buildProjectToolMenuItems('none')).toEqual([
      { kind: 'cursor', label: 'Cursor', launchLabel: '正在打开 Cursor…' },
      { kind: 'finder', label: 'Finder', launchLabel: '正在打开 Finder…' },
      { kind: 'codex', label: 'Codex App', launchLabel: '正在准备 Codex App…' },
      { kind: 'code', label: 'VS Code', launchLabel: '正在打开 VS Code…' }
    ])
  })

  it('uses Cursor as the default project open target', () => {
    const items = buildProjectToolMenuItems('none')

    expect(DEFAULT_PROJECT_TOOL_KIND).toBe('cursor')
    expect(findProjectToolMenuItem(items, DEFAULT_PROJECT_TOOL_KIND)?.label).toBe('Cursor')
    expect(findProjectToolMenuItem(items, 'finder')?.label).toBe('Finder')
  })

  it('normalizes persisted project tool kinds', () => {
    expect(normalizeProjectToolKind('code')).toBe('code')
    expect(normalizeProjectToolKind('terminal')).toBeNull()
    expect(normalizeProjectToolKind(undefined)).toBeNull()
  })

  it('only shows project tools for project-level workspaces', () => {
    expect(isProjectToolWorkspaceKind('project')).toBe(true)
    expect(isProjectToolWorkspaceKind('ux')).toBe(true)
    expect(isProjectToolWorkspaceKind('knowledge')).toBe(false)
    expect(isProjectToolWorkspaceKind('asset')).toBe(false)
    expect(isProjectToolWorkspaceKind(undefined)).toBe(false)
  })
})
