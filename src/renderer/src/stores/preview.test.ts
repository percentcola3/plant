import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePreviewStore } from './preview'
import { useWorkspacesStore } from './workspaces'

function project(workspaceId: string, relPath: string, name: string, spaceSlug = '__public__') {
  return {
    key: `${workspaceId}::${spaceSlug}::${relPath}`,
    workspaceId,
    spaceSlug,
    relPath,
    name
  }
}

describe('preview store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        confirm: vi.fn().mockReturnValue(true),
        api: {
          'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
          'workspace.setWatchScope': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
          'workspace.scan': vi.fn().mockResolvedValue({
            ok: true,
            data: { kind: 'project', warnings: [], refs: [] }
          })
        }
      }
    })
  })

  it('syncs only the active internal project as the watch scope', async () => {
    vi.useFakeTimers()
    try {
      const store = usePreviewStore()
      const order = project('ws1', 'outputs/order', 'order')
      const refund = project('ws1', 'outputs/refund', 'refund')
      const setWatchScope = vi.mocked(window.api['workspace.setWatchScope'])

      store.openProject({ project: order })
      await vi.advanceTimersByTimeAsync(300)
      expect(setWatchScope).toHaveBeenLastCalledWith({
        workspaceId: 'ws1',
        projectRelPath: 'outputs/order'
      })

      store.openProject({ project: refund })
      await vi.advanceTimersByTimeAsync(300)
      expect(setWatchScope).toHaveBeenLastCalledWith({
        workspaceId: 'ws1',
        projectRelPath: 'outputs/refund'
      })
      expect(setWatchScope).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an opened project watched on home and stops after closing all projects', async () => {
    vi.useFakeTimers()
    try {
      const store = usePreviewStore()
      const order = project('ws1', 'outputs/order', 'order')
      const setWatchScope = vi.mocked(window.api['workspace.setWatchScope'])

      store.openProject({ project: order })
      await vi.advanceTimersByTimeAsync(300)
      setWatchScope.mockClear()

      store.deactivate()
      await vi.advanceTimersByTimeAsync(300)
      expect(setWatchScope).not.toHaveBeenCalled()

      store.clearAll()
      await vi.advanceTimersByTimeAsync(300)
      expect(setWatchScope).toHaveBeenCalledOnce()
      expect(setWatchScope).toHaveBeenCalledWith({
        workspaceId: null,
        projectRelPath: null
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('resyncs the same project after its root workspace was reactivated', async () => {
    vi.useFakeTimers()
    try {
      const workspaces = useWorkspacesStore()
      workspaces.activeId = 'ws1'
      vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
      const store = usePreviewStore()
      const order = project('ws1', 'outputs/order', 'order')
      const setWatchScope = vi.mocked(window.api['workspace.setWatchScope'])

      store.openProject({ project: order })
      await vi.advanceTimersByTimeAsync(300)
      setWatchScope.mockClear()

      await store.activateProject(order.key)
      await vi.advanceTimersByTimeAsync(300)

      expect(setWatchScope).toHaveBeenCalledOnce()
      expect(setWatchScope).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        projectRelPath: 'outputs/order'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates the selected file when reusing an existing files tab', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order')

    store.openTab({
      type: 'files',
      title: 'order',
      url: '',
      workspaceId: 'ws1',
      project: order,
      filesMeta: {
        rootRelPath: 'outputs/order',
        primaryRelPath: 'outputs/order/index.html'
      }
    })
    store.openTab({
      type: 'files',
      title: 'order',
      url: '',
      workspaceId: 'ws1',
      project: order,
      filesMeta: {
        rootRelPath: 'outputs/order',
        primaryRelPath: 'outputs/order/草稿1.sketch.json'
      }
    })

    expect(store.tabs).toHaveLength(1)
    expect(store.activeTab?.filesMeta?.primaryRelPath).toBe('outputs/order/草稿1.sketch.json')
  })

  it('opens one canonical files tab for a project', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order', 'alice')
    const openProject = (store as unknown as {
      openProject?: (input: { project: typeof order; primaryRelPath: string }) => void
    }).openProject

    expect(typeof openProject).toBe('function')
    openProject!({ project: order, primaryRelPath: 'outputs/order/index.html' })
    openProject!({ project: order, primaryRelPath: 'outputs/order/details.html' })

    expect(store.tabs).toHaveLength(1)
    expect(store.activeTab?.type).toBe('files')
    expect(store.activeTab?.filesMeta).toEqual({
      rootRelPath: 'outputs/order',
      primaryRelPath: 'outputs/order/details.html',
      activeRelPath: 'outputs/order/details.html'
    })
  })

  it('tracks the active file inside a project files tab', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'features/order', 'order')

    store.openProject({ project: order, primaryRelPath: 'features/order/index.html' })
    const tabId = store.activeTab?.id
    expect(tabId).toBeTruthy()

    store.setProductFilesActiveRelPath(tabId!, 'features/order/detail.html')
    expect(store.activeTab?.filesMeta?.activeRelPath).toBe('features/order/detail.html')

    store.setProductFilesActiveRelPath(tabId!, null)
    expect(store.activeTab?.filesMeta?.activeRelPath).toBeUndefined()
  })

  it('keeps the last opened file when the same project is reopened', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'features/order', 'order')

    store.openProject({ project: order, primaryRelPath: 'features/order/index.html' })
    const tabId = store.activeTab?.id
    store.setProductFilesActiveRelPath(tabId!, 'features/order/doc/方案.md')
    store.openProject({ project: order, primaryRelPath: 'features/order/index.html' })

    expect(store.activeTab?.filesMeta?.activeRelPath).toBe('features/order/doc/方案.md')
    expect(store.activeTab?.filesMeta?.primaryRelPath).toBe('features/order/index.html')
  })

  it('increments product file reload tokens by workspace and root path', () => {
    const store = usePreviewStore()

    expect(store.productFilesReloadToken('ws1', 'features/order/')).toBe(0)
    store.notifyProductFilesChanged({ workspaceId: 'ws1', rootRelPath: 'features/order' })

    expect(store.productFilesReloadToken('ws1', 'features/order/')).toBe(1)
    expect(store.productFilesReloadToken('ws2', 'features/order')).toBe(0)
  })

  it('keeps device preview state on the canonical project files tab', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order', 'alice')

    store.openProject({ project: order, primaryRelPath: 'outputs/order/index.html' })

    expect(store.activeTab?.productMeta).toMatchObject({
      path: 'outputs/order',
      devicePreset: '1440×900',
      responsive: false,
      deviceWidth: 1440,
      deviceHeight: 900,
      rotate: false,
      zoom: 1
    })
  })

  it('keeps opened projects when switching back to the home tab', async () => {
    const workspaces = useWorkspacesStore()
    workspaces.activeId = 'ws1'
    vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order')

    store.openProject({ project: order, primaryRelPath: 'outputs/order/index.html' })
    store.deactivate()

    expect(store.hasOpenTabs).toBe(true)
    expect(store.isPreviewActive).toBe(false)
    expect(store.activeTabId).not.toBeNull()
    expect(store.openProjects.map(item => item.key)).toEqual([order.key])

    await store.activateProject(order.key)

    expect(store.isPreviewActive).toBe(true)
    expect(store.activeProjectKey).toBe(order.key)
  })

  it('backfills device preview state when reusing an older files tab', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order', 'alice')
    store.openTab({
      type: 'files',
      title: 'order',
      url: '',
      workspaceId: 'ws1',
      project: order,
      filesMeta: { rootRelPath: 'outputs/order' }
    })

    store.openProject({ project: order, primaryRelPath: 'outputs/order/index.html' })

    expect(store.activeTab?.productMeta?.path).toBe('outputs/order')
  })

  it('does not leave a project with unsaved files unless the user confirms', async () => {
    const workspaces = useWorkspacesStore()
    workspaces.activeId = 'ws1'
    const store = usePreviewStore()
    const activateSpace = vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
    const confirm = vi.mocked(window.confirm)
    confirm.mockReturnValue(false)
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openProject({ project: order, primaryRelPath: 'outputs/order/index.html' })
    const orderTabId = store.activeTabId!
    store.openProject({ project: refund, primaryRelPath: 'outputs/refund/index.html' })
    await store.activateProject(order.key)
    activateSpace.mockClear()
    store.setTabDirty(orderTabId, true)

    await store.activateProject(refund.key)

    expect(confirm).toHaveBeenCalledOnce()
    expect(activateSpace).not.toHaveBeenCalled()
    expect(store.activeProjectKey).toBe(order.key)
  })

  it('discards confirmed project edits before switching and does not prompt again', async () => {
    const workspaces = useWorkspacesStore()
    workspaces.activeId = 'ws1'
    const store = usePreviewStore()
    vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
    const confirm = vi.mocked(window.confirm)
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openProject({ project: order, primaryRelPath: 'outputs/order/index.html' })
    const orderTabId = store.activeTabId!
    store.openProject({ project: refund, primaryRelPath: 'outputs/refund/index.html' })
    await store.activateProject(order.key)
    store.setTabDirty(orderTabId, true)

    await store.activateProject(refund.key)
    store.clearAll()

    expect(confirm).toHaveBeenCalledOnce()
    expect(store.tabs).toHaveLength(0)
  })

  it('keeps the current file when reopening a dirty project is not confirmed', () => {
    const store = usePreviewStore()
    const confirm = vi.mocked(window.confirm)
    confirm.mockReturnValue(false)
    const order = project('ws1', 'outputs/order', 'order')

    store.openProject({ project: order, primaryRelPath: 'outputs/order/index.html' })
    store.setTabDirty(store.activeTabId!, true)
    store.openProject({ project: order, primaryRelPath: 'outputs/order/details.html' })

    expect(confirm).toHaveBeenCalledOnce()
    expect(store.activeTab?.filesMeta?.primaryRelPath).toBe('outputs/order/index.html')
  })

  it('keeps internal projects in one root workspace and restores each active resource tab', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openTab({
      type: 'product',
      title: 'order',
      url: 'http://local/ws1/order',
      workspaceId: 'ws1',
      project: order
    })
    store.openTab({
      type: 'files',
      title: 'order',
      url: '',
      workspaceId: 'ws1',
      project: order,
      filesMeta: { rootRelPath: 'outputs/order' }
    })
    store.openTab({
      type: 'product',
      title: 'refund',
      url: 'http://local/ws1/refund',
      workspaceId: 'ws1',
      project: refund
    })

    expect(store.openProjects.map(item => item.name)).toEqual(['order', 'refund'])
    expect(store.activeProjectKey).toBe(refund.key)
    expect(store.activeTab?.workspaceId).toBe('ws1')

    await store.activateProject(order.key)

    expect(store.activeProjectKey).toBe(order.key)
    expect(store.activeTab?.type).toBe('files')
    expect(store.tabsForProject(order.key)).toHaveLength(2)
    expect(store.tabsForProject(refund.key)).toHaveLength(1)
  })

  it('keeps open project tabs when returning to home', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openProject({ project: order })
    store.openProject({ project: refund })

    expect(store.isPreviewActive).toBe(true)
    expect(store.openProjects).toHaveLength(2)

    store.hideCanvas()

    expect(store.isPreviewActive).toBe(false)
    expect(store.openProjects).toHaveLength(2)
    expect(store.tabs).toHaveLength(2)
  })

  it('does not switch the root workspace when activating another internal project in the same root', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    const setActive = vi.spyOn(workspaces, 'setActive')
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openTab({ type: 'product', title: 'order', url: 'order', workspaceId: 'ws1', project: order })
    store.openTab({ type: 'product', title: 'refund', url: 'refund', workspaceId: 'ws1', project: refund })
    await store.activateProject(order.key)

    expect(setActive).not.toHaveBeenCalled()
    expect(workspaces.activeId).toBe('ws1')
  })

  it('switches simple workspace tabs without reading personal spaces', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    workspaces.list = [
      {
        id: 'ws1',
        kind: 'project',
        workflowMode: 'simple',
        name: '本地工作台',
        path: '/tmp/ws1',
        defaultBranch: 'main',
        addedAt: '2026-07-21T00:00:00.000Z',
        lastActiveAt: '2026-07-21T00:00:00.000Z'
      }
    ]
    const activateSpace = vi.spyOn(workspaces, 'activateSpace')
    const order = project('ws1', 'features/order', 'order')
    const refund = project('ws1', 'features/refund', 'refund')

    store.openProject({ project: order })
    store.openProject({ project: refund })
    await store.activateProject(order.key)

    expect(activateSpace).not.toHaveBeenCalled()
    expect(store.activeProjectKey).toBe(order.key)
  })

  it('activates the workspace owned by the selected project tab', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    const activateSpace = vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
    const alice = project('ws1', 'outputs/order', 'order', 'alice')
    const bob = project('ws1', 'outputs/order', 'order', 'bob')

    store.openProject({ project: alice, primaryRelPath: 'outputs/order/index.html' })
    store.openProject({ project: bob, primaryRelPath: 'outputs/order/index.html' })
    activateSpace.mockClear()

    await store.activateProject(alice.key)

    expect(activateSpace).toHaveBeenCalledWith('ws1', 'alice')
    expect(store.activeProjectKey).toBe(alice.key)
  })

  it('switches the root workspace and keeps same-named internal projects distinct', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    const activateSpace = vi.spyOn(workspaces, 'activateSpace').mockImplementation(async (id) => {
      workspaces.activeId = id
      return true
    })
    const first = project('ws1', 'outputs/order', 'order')
    const second = project('ws2', 'outputs/order', 'order')

    store.openTab({ type: 'product', title: 'order', url: 'ws1-order', workspaceId: 'ws1', project: first })
    store.openTab({ type: 'product', title: 'order', url: 'ws2-order', workspaceId: 'ws2', project: second })

    expect(store.openProjects.map(item => item.key)).toEqual([first.key, second.key])
    await store.activateProject(first.key)

    expect(activateSpace).toHaveBeenLastCalledWith('ws1', '__public__')
    expect(store.activeProjectKey).toBe(first.key)
  })

  it('keeps shared root resource URLs scoped to each internal project', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openTab({
      type: 'uikit-components',
      title: '组件',
      url: 'http://local/ws1/components',
      workspaceId: 'ws1',
      project: order
    })
    store.openTab({
      type: 'uikit-components',
      title: '组件',
      url: 'http://local/ws1/components',
      workspaceId: 'ws1',
      project: refund
    })

    expect(store.tabs).toHaveLength(2)
    expect(store.tabsForProject(order.key)).toHaveLength(1)
    expect(store.tabsForProject(refund.key)).toHaveLength(1)
  })

  it('switches the root workspace when closing the last tab of a cross-root project', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    const activateSpace = vi.spyOn(workspaces, 'activateSpace').mockImplementation(async (id) => {
      workspaces.activeId = id
      return true
    })
    const first = project('ws1', 'outputs/order', 'order')
    const second = project('ws2', 'outputs/refund', 'refund')

    store.openTab({ type: 'product', title: 'order', url: 'order', workspaceId: 'ws1', project: first })
    store.openTab({ type: 'product', title: 'refund', url: 'refund', workspaceId: 'ws2', project: second })
    await vi.waitFor(() => expect(workspaces.activeId).toBe('ws2'))
    activateSpace.mockClear()
    const secondTabId = store.activeTabId
    expect(secondTabId).not.toBeNull()

    store.closeTab(secondTabId!)

    await vi.waitFor(() => expect(workspaces.activeId).toBe('ws1'))
    expect(activateSpace).toHaveBeenCalledWith('ws1', '__public__')
    expect(store.activeProjectKey).toBe(first.key)
  })

  it('closes only the selected internal project', async () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order')
    const refund = project('ws1', 'outputs/refund', 'refund')

    store.openTab({ type: 'product', title: 'order', url: 'order', workspaceId: 'ws1', project: order })
    store.openTab({ type: 'product', title: 'refund', url: 'refund', workspaceId: 'ws1', project: refund })
    await store.closeProject(order.key)

    expect(store.openProjects.map(item => item.key)).toEqual([refund.key])
    expect(store.tabs.map(tab => tab.project?.key)).toEqual([refund.key])
    expect(store.activeProjectKey).toBe(refund.key)
  })

  it('activates the next workspace after closing a same-root project tab', async () => {
    const workspaces = useWorkspacesStore()
    const store = usePreviewStore()
    workspaces.activeId = 'ws1'
    const activateSpace = vi.spyOn(workspaces, 'activateSpace').mockResolvedValue(true)
    const alice = project('ws1', 'outputs/order', 'order', 'alice')
    const bob = project('ws1', 'outputs/refund', 'refund', 'bob')

    store.openProject({ project: alice })
    store.openProject({ project: bob })
    activateSpace.mockClear()
    const bobTabId = store.activeTabId!

    store.closeTab(bobTabId)

    await vi.waitFor(() => expect(activateSpace).toHaveBeenCalledWith('ws1', 'alice'))
  })

  it('keeps project workbenches open when return is cancelled for unsaved files', () => {
    const store = usePreviewStore()
    const order = project('ws1', 'outputs/order', 'order')
    store.openProject({ project: order })
    const tabId = store.activeTabId!
    const setTabDirty = (store as unknown as { setTabDirty?: (id: string, dirty: boolean) => void }).setTabDirty
    expect(typeof setTabDirty).toBe('function')
    setTabDirty!(tabId, true)
    Object.assign(window, { confirm: vi.fn().mockReturnValue(false) })

    store.clearAll()

    expect(store.tabs).toHaveLength(1)
    expect(window.confirm).toHaveBeenCalled()
  })
})
