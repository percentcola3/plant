import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AiTaskSummary, Workspace } from '@shared/types'
import { useAiTasksStore } from './ai-tasks'
import { useUiStore } from './ui'
import { useWorkspacesStore } from './workspaces'
import { usePreviewStore } from './preview'
import { createDefaultProductMeta } from '@/lib/preview/product-preview'
import { createPreviewProjectContext } from '@/lib/preview/preview-project'

function task(overrides: Partial<AiTaskSummary> = {}): AiTaskSummary {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Project Alpha',
    workspacePath: '/tmp/project-alpha',
    status: 'running',
    title: '生成登录页',
    promptPreview: '请生成登录页',
    workArea: { kind: 'feature', relPath: 'features/login' },
    createdAt: '2026-07-04T01:00:00.000Z',
    updatedAt: '2026-07-04T01:00:00.000Z',
    changedArtifacts: [],
    unread: false,
    ...overrides
  }
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1',
    kind: 'project',
    name: 'Project Alpha',
    path: '/tmp/project-alpha',
    defaultBranch: 'main',
    addedAt: '2026-07-04T01:00:00.000Z',
    lastActiveAt: '2026-07-04T01:00:00.000Z',
    ...overrides
  }
}

describe('ai tasks store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {},
        events: { on: vi.fn(() => () => undefined) }
      }
    })
  })

  it('loads tasks from IPC', async () => {
    const item = task()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'aiTask.list': vi.fn().mockResolvedValue({ ok: true, data: [item] })
      }
    })

    const store = useAiTasksStore()
    await store.load()

    expect(store.tasks).toEqual([item])
  })

  it('opens a project feature task in the matching project page', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'project', warnings: [], refs: [], features: [], hasKnowledgeDir: false, personalSpace: null } })
      }
    })

    const workspaces = useWorkspacesStore()
    workspaces.list = [workspace()]
    const ui = useUiStore()
    const store = useAiTasksStore()

    await store.openTask(task())

    expect(workspaces.activeId).toBe('workspace-1')
    expect(ui.currentView).toBe('features-page')
    expect(ui.terminalPanelOpen).toBe(true)
  })

  it('keeps the previous project workbench when opening a task from another project', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'ux', warnings: [], themes: [], activeTheme: null, componentsExists: true, hasStylesDir: true, hasOutputsDir: true, personalSpace: null } })
      }
    })

    const workspaces = useWorkspacesStore()
    workspaces.activeId = 'workspace-1'
    workspaces.list = [
      workspace({ id: 'workspace-1', kind: 'ux', name: 'Project One' }),
      workspace({ id: 'workspace-2', kind: 'ux', name: 'Project Two' })
    ]
    const preview = usePreviewStore()
    const oldProject = createPreviewProjectContext('workspace-1', '__public__', 'outputs/old', 'old')
    preview.openTab({
      type: 'product',
      title: 'old',
      url: 'http://local/workspace-1/old/index.html',
      workspaceId: 'workspace-1',
      project: oldProject,
      productMeta: createDefaultProductMeta('outputs/old')
    })

    const store = useAiTasksStore()
    await store.openTask(task({
      workspaceId: 'workspace-2',
      workspaceName: 'Project Two',
      workArea: { kind: 'ui-product', relPath: 'outputs/order' }
    }))

    expect(workspaces.activeId).toBe('workspace-2')
    expect(preview.tabs).toHaveLength(2)
    expect(preview.openProjects.map(project => project.name)).toEqual(['old', 'order'])
    expect(preview.tabsForProject(oldProject.key)).toHaveLength(1)
    expect(preview.tabsForProject('workspace-2::__public__::outputs/order')).toHaveLength(1)
    expect(preview.activeProjectKey).toBe('workspace-2::__public__::outputs/order')
    expect(preview.activeTab?.workspaceId).toBe('workspace-2')
    expect(preview.activeTab?.project?.name).toBe('order')
    expect(preview.activeTab?.type).toBe('files')
    expect(preview.activeTab?.filesMeta).toEqual({
      rootRelPath: 'outputs/order',
      primaryRelPath: 'outputs/order/index.html'
    })
  })

  it('opens a legacy hidden AI task through its base workspace', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'project', warnings: [], refs: [], features: [], hasKnowledgeDir: false, personalSpace: null } })
      }
    })

    const workspaces = useWorkspacesStore()
    workspaces.list = [workspace({ id: 'workspace-1' })]
    const ui = useUiStore()
    const store = useAiTasksStore()

    await store.openTask(task({
      workspaceId: 'workspace-1::ai-task::task-1',
      baseWorkspaceId: 'workspace-1'
    }))

    expect(workspaces.activeId).toBe('workspace-1')
    expect(ui.currentView).toBe('features-page')
  })

  it('opens a task recorded on a hidden derived workspace through its visible parent', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'project', warnings: [], refs: [], features: [], hasKnowledgeDir: false, personalSpace: null } })
      }
    })

    const workspaces = useWorkspacesStore()
    workspaces.list = [
      workspace({ id: 'workspace-1' }),
      workspace({
        id: 'workspace-1::space::b',
        hidden: 'space',
        parentWorkspaceId: 'workspace-1',
        spaceSlug: 'b'
      })
    ]
    const store = useAiTasksStore()

    await store.openTask(task({
      workspaceId: 'workspace-1::space::b'
    }))

    expect(workspaces.activeId).toBe('workspace-1')
    expect(window.api['workspace.setActive']).toHaveBeenCalledWith({ id: 'workspace-1' })
  })

  it('does not activate a task workspace when no visible parent can be found', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'workspace.list': vi.fn().mockResolvedValue({ ok: true, data: [] }),
        'workspace.activeId': vi.fn().mockResolvedValue({ ok: true, data: null }),
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined })
      }
    })

    const ui = useUiStore()
    const toast = vi.spyOn(ui, 'showToast')
    const store = useAiTasksStore()

    await store.openTask(task({ workspaceId: 'missing-hidden-workspace' }))

    expect(window.api['workspace.setActive']).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('error', '任务所属项目不存在或已隐藏，无法打开', 5000)
  })

  it('keeps the event watcher active until all consumers stop watching', () => {
    const unsubscribe = vi.fn()
    const on = vi.fn(() => unsubscribe)
    Object.defineProperty(window, 'events', {
      configurable: true,
      value: { on }
    })

    const store = useAiTasksStore()

    store.startWatching()
    store.startWatching()
    store.stopWatching()

    expect(on).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()

    store.stopWatching()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('notifies project file tabs when a feature task completes with changed artifacts', () => {
    const handlers: Array<(payload: unknown) => void> = []
    Object.defineProperty(window, 'events', {
      configurable: true,
      value: {
        on: vi.fn((_event: string, cb: (payload: unknown) => void) => {
          handlers.push(cb)
          return () => undefined
        })
      }
    })
    const preview = usePreviewStore()
    const store = useAiTasksStore()

    store.startWatching()
    handlers[0]?.(task({
      status: 'completed',
      changedArtifacts: ['features/login/index.html']
    }))

    expect(preview.productFilesReloadToken('workspace-1', 'features/login')).toBe(1)
  })

  it('also notifies the visible parent workspace for hidden derived task workspaces', () => {
    const handlers: Array<(payload: unknown) => void> = []
    Object.defineProperty(window, 'events', {
      configurable: true,
      value: {
        on: vi.fn((_event: string, cb: (payload: unknown) => void) => {
          handlers.push(cb)
          return () => undefined
        })
      }
    })
    const preview = usePreviewStore()
    const store = useAiTasksStore()

    store.startWatching()
    handlers[0]?.(task({
      workspaceId: 'workspace-1::ai-task::task-1',
      baseWorkspaceId: 'workspace-1',
      status: 'completed',
      changedArtifacts: ['features/login/index.html']
    }))

    expect(preview.productFilesReloadToken('workspace-1::ai-task::task-1', 'features/login')).toBe(1)
    expect(preview.productFilesReloadToken('workspace-1', 'features/login')).toBe(1)
  })

  it('aborts a running task and reloads the lane data', async () => {
    const abort = vi.fn().mockResolvedValue({ ok: true, data: { ok: true } })
    const list = vi.fn().mockResolvedValue({ ok: true, data: [] })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'aiTask.abort': abort,
        'aiTask.list': list
      }
    })

    const store = useAiTasksStore()
    const ok = await store.abortTask(task({ id: 'task-1', status: 'running' }))

    expect(ok).toBe(true)
    expect(abort).toHaveBeenCalledWith({ taskId: 'task-1' })
    expect(list).toHaveBeenCalled()
  })

  it('opens a task by id after fetching it from IPC when it is not loaded locally', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        'aiTask.get': vi.fn().mockResolvedValue({ ok: true, data: task() }),
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'project', warnings: [], refs: [], features: [], hasKnowledgeDir: false, personalSpace: null } })
      }
    })
    const workspaces = useWorkspacesStore()
    workspaces.list = [workspace()]
    const ui = useUiStore()
    const store = useAiTasksStore()

    await store.openTaskById('task-1')

    expect(workspaces.activeId).toBe('workspace-1')
    expect(ui.currentView).toBe('features-page')
  })
})
