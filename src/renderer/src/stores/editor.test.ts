import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Workspace } from '@shared/types'
import { useEditorStore } from './editor'
import { useWorkspacesStore } from './workspaces'

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-a',
    kind: 'project',
    name: 'Project A',
    path: '/tmp/project-a',
    defaultBranch: 'main',
    addedAt: '2026-07-10T00:00:00.000Z',
    lastActiveAt: '2026-07-10T00:00:00.000Z',
    ...overrides
  }
}

describe('editor store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {
          'editor.readTextFile': vi.fn(async (input: { workspaceId: string; relPath: string }) => ({
            ok: true,
            data: {
              content: `${input.workspaceId}:${input.relPath}`,
              mtime: `${input.workspaceId}-mtime`,
            }
          })),
          'preview.docUrl': vi.fn(async (input: { workspaceId: string }) => ({
            ok: true,
            data: { url: `http://localhost/${input.workspaceId}/index.html` }
          }))
        },
        confirm: vi.fn(() => true),
        dispatchEvent: vi.fn()
      }
    })
  })

  it('keeps editor sessions for multiple active workspaces', async () => {
    const workspaces = useWorkspacesStore()
    workspaces.list = [
      workspace(),
      workspace({ id: 'workspace-b', name: 'Project B', path: '/tmp/project-b' })
    ]
    workspaces.activeId = 'workspace-a'

    const editor = useEditorStore()
    await editor.openProjectMarkdown('features/a/README.md')
    const firstKey = editor.activeSessionKey
    editor.updateContent('dirty content from workspace a')

    workspaces.activeId = 'workspace-b'
    await editor.openProjectMarkdown('features/b/README.md')

    expect(editor.sessions).toHaveLength(2)
    expect(editor.session?.projectId).toBe('workspace-b')
    expect(editor.sessions.find((item) => item.projectId === 'workspace-a')?.content)
      .toBe('dirty content from workspace a')

    editor.activateSession(firstKey ?? '')

    expect(editor.session?.projectId).toBe('workspace-a')
    expect(editor.session?.content).toBe('dirty content from workspace a')
  })

  it('opens keyed preview sessions in the requested workspace instead of only the active one', async () => {
    const workspaces = useWorkspacesStore()
    workspaces.activeId = 'workspace-a'

    const editor = useEditorStore()
    await editor.openInKey('tab-b', 'markdown', 'docs/intro.md', 'workspace-b')

    expect(editor.tabSession('tab-b').value?.projectId).toBe('workspace-b')
    expect(window.api['editor.readTextFile']).toHaveBeenCalledWith({
      workspaceId: 'workspace-b',
      relPath: 'docs/intro.md',
      scope: 'docs'
    })
  })

  it('hides the document view for left navigation without discarding its session', async () => {
    const workspaces = useWorkspacesStore()
    workspaces.activeId = 'workspace-a'
    const editor = useEditorStore()
    await editor.openProjectMarkdown('system.md')
    editor.updateContent('unsaved')

    editor.hide()
    expect(editor.isOpen).toBe(false)
    expect(editor.sessions).toHaveLength(1)
    expect(editor.session?.content).toBe('unsaved')

    await editor.openProjectMarkdown('system.md')
    expect(editor.isOpen).toBe(true)
    expect(editor.session?.content).toBe('unsaved')
  })
})
