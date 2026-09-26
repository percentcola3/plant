import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspacesStore } from './workspaces'
import { useUiStore } from './ui'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('workspaces store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('marks active workspace as scanning while switching projects', async () => {
    const scanResult = deferred<unknown>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockReturnValue(scanResult.promise)
      }
    })

    const store = useWorkspacesStore()
    store.scan = { kind: 'project', warnings: [], refs: [] } as any

    const switching = store.setActive('next-workspace')
    await vi.waitFor(() => {
      expect(store.activeId).toBe('next-workspace')
    })

    expect(store.scan).toBeNull()
    expect(store.scanLoading).toBe(true)
    expect(store.activeScanLoading).toBe(true)

    scanResult.resolve({ ok: true, data: { kind: 'project', warnings: ['ready'], refs: [] } })
    await switching

    expect(store.scan).toMatchObject({ kind: 'project', warnings: ['ready'] })
    expect(store.scanLoading).toBe(false)
    expect(store.activeScanLoading).toBe(false)
  })

  it('tracks workspace activation until the active scan completes', async () => {
    const setActiveResult = deferred<unknown>()
    const scanResult = deferred<unknown>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockReturnValue(setActiveResult.promise),
        'workspace.scan': vi.fn().mockReturnValue(scanResult.promise)
      }
    })

    const store = useWorkspacesStore()
    store.activeId = 'current-workspace'

    const switching = store.setActive('next-workspace')

    expect(store.activatingWorkspaceId).toBe('next-workspace')
    expect(store.activeSwitchLoading).toBe(true)
    expect(store.activeId).toBe('current-workspace')

    setActiveResult.resolve({ ok: true, data: undefined })
    await vi.waitFor(() => {
      expect(store.activeId).toBe('next-workspace')
    })
    expect(store.activatingWorkspaceId).toBe('next-workspace')
    expect(store.activeScanLoading).toBe(true)

    scanResult.resolve({ ok: true, data: { kind: 'project', warnings: [], refs: [] } })
    await switching

    expect(store.activatingWorkspaceId).toBeNull()
    expect(store.activeSwitchLoading).toBe(false)
    expect(store.activeScanLoading).toBe(false)
  })

  it('closes the terminal panel after switching workspace', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'workspace.setActive': vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'project', warnings: [], refs: [] } })
      }
    })

    const ui = useUiStore()
    const store = useWorkspacesStore()
    store.activeId = 'current-workspace'
    ui.openTerminalPanel({
      kind: 'workspace-home',
      workspaceId: 'current-workspace'
    })

    await store.setActive('next-workspace')

    expect(ui.terminalPanelOpen).toBe(false)
    expect(ui.terminalOpenContext).toBeNull()
  })

  it('closes the terminal panel before checking out the home branch', async () => {
    const checkoutHome = vi.fn().mockResolvedValue({ ok: true, data: undefined })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'workspace.checkoutHome': checkoutHome,
        'workspace.scan': vi.fn().mockResolvedValue({ ok: true, data: { kind: 'project', warnings: [], refs: [] } })
      }
    })

    const ui = useUiStore()
    const store = useWorkspacesStore()
    store.activeId = 'current-workspace'
    ui.openTerminalPanel({
      kind: 'workspace-home',
      workspaceId: 'current-workspace'
    })

    await store.checkoutHome('current-workspace')

    expect(checkoutHome).toHaveBeenCalledWith({ workspaceId: 'current-workspace', preCommitMessage: undefined })
    expect(ui.terminalPanelOpen).toBe(false)
    expect(ui.terminalOpenContext).toBeNull()
  })

  it('can suppress a knowledge-only active workspace during startup refresh', async () => {
    const listMock = vi.fn().mockResolvedValue({
      ok: true,
      data: [{
        id: 'knowledge-ws',
        kind: 'knowledge',
        name: '剪页库',
        path: '/tmp/clips',
        defaultBranch: 'main',
        addedAt: '2026-07-01T00:00:00.000Z',
        lastActiveAt: '2026-07-01T00:00:00.000Z'
      }]
    })
    const activeIdMock = vi.fn().mockResolvedValue({ ok: true, data: 'knowledge-ws' })
    const scanMock = vi.fn().mockResolvedValue({ ok: true, data: { kind: 'knowledge', warnings: [] } })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'workspace.list': listMock,
        'workspace.activeId': activeIdMock,
        'workspace.scan': scanMock
      }
    })

    const store = useWorkspacesStore()
    await store.refresh({ clearKnowledgeOnlyActive: true })

    expect(store.list).toHaveLength(1)
    expect(store.activeId).toBeNull()
    expect(scanMock).not.toHaveBeenCalled()
  })

  it('projects personalSpace from an active ux scan result', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {}
    })

    const store = useWorkspacesStore()
    // 非 ux 扫描结果 → personalSpace 为 null
    store.scan = { kind: 'project', warnings: [], refs: [] } as any
    expect(store.personalSpace).toBeNull()
    // ux 扫描结果带 personalSpace → 投影出来
    const space = { slug: 'eric', branch: 'space/eric', createdAt: '2026-06-23T00:00:00.000Z' }
    store.scan = {
      kind: 'ux',
      warnings: [],
      themes: [],
      activeTheme: null,
      componentsExists: true,
      hasStylesDir: true,
      hasOutputsDir: true,
      personalSpace: space
    } as any
    expect(store.personalSpace).toEqual(space)
  })

  it('ensures a personal space and refreshes the scan', async () => {
    const ensureMock = vi.fn().mockResolvedValue({
      ok: true,
      data: { slug: 'eric', branch: 'space/eric', createdAt: '2026-06-23T00:00:00.000Z' }
    })
    const scanMock = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        kind: 'ux',
        warnings: [],
        themes: [],
        activeTheme: null,
        componentsExists: true,
        hasStylesDir: true,
        hasOutputsDir: true,
        personalSpace: { slug: 'eric', branch: 'space/eric', createdAt: '2026-06-23T00:00:00.000Z' }
      }
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'personalSpace.ensure': ensureMock,
        'workspace.scan': scanMock
      }
    })

    const store = useWorkspacesStore()
    store.activeId = 'ux-ws'

    const result = await store.ensurePersonalSpace('ux-ws', 'eric')

    expect(ensureMock).toHaveBeenCalledWith({ workspaceId: 'ux-ws', slug: 'eric' })
    expect(result).toEqual({ slug: 'eric', branch: 'space/eric', createdAt: '2026-06-23T00:00:00.000Z' })
    expect(scanMock).toHaveBeenCalledWith({ id: 'ux-ws' })
    expect(store.personalSpace?.branch).toBe('space/eric')
  })

  it('auto-commits on UNCOMMITTED_CHANGES and retries ensuring the personal space', async () => {
    const ensureMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'UNCOMMITTED_CHANGES', message: 'dirty' })
      .mockResolvedValueOnce({
        ok: true,
        data: { slug: 'eric', branch: 'space/eric', createdAt: '2026-06-23T00:00:00.000Z' }
      })
    const scanMock = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        kind: 'ux',
        warnings: [],
        themes: [],
        activeTheme: null,
        componentsExists: true,
        hasStylesDir: true,
        hasOutputsDir: true,
        personalSpace: { slug: 'eric', branch: 'space/eric', createdAt: '2026-06-23T00:00:00.000Z' }
      }
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })
    Object.defineProperty(globalThis.window, 'api', {
      configurable: true,
      value: {
        'personalSpace.ensure': ensureMock,
        'workspace.scan': scanMock
      }
    })

    const store = useWorkspacesStore()
    store.activeId = 'ux-ws'

    const result = await store.ensurePersonalSpace('ux-ws')

    expect(ensureMock).toHaveBeenCalledTimes(2)
    // 第二次调用带 preCommitMessage（wip(space): ...）
    const secondCallArg = ensureMock.mock.calls[1][0]
    expect(secondCallArg.preCommitMessage).toMatch(/^wip\(space\): /)
    expect(result?.branch).toBe('space/eric')
  })

  it('serializes personal-space activation so the latest request wins', async () => {
    const firstSwitch = deferred<{ ok: true; data: { externalInitWarnings: string[] } }>()
    let activeSlug = 'initial'
    const switchMock = vi.fn(({ slug }: { slug: string }) => {
      if (slug === 'alice') {
        return firstSwitch.promise.then(result => {
          activeSlug = slug
          return result
        })
      }
      activeSlug = slug
      return Promise.resolve({ ok: true, data: { externalInitWarnings: [] } })
    })
    const listSpacesMock = vi.fn(() => Promise.resolve({
      ok: true,
      data: { activeSlug, spaces: [] }
    }))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {
          'personalSpace.list': listSpacesMock,
          'personalSpace.switch': switchMock,
          'workspace.list': vi.fn().mockResolvedValue({ ok: true, data: [] }),
          'workspace.activeId': vi.fn().mockResolvedValue({ ok: true, data: 'ux-ws' }),
          'workspace.scan': vi.fn().mockResolvedValue({
            ok: true,
            data: { kind: 'ux', warnings: [], refs: [] }
          })
        }
      }
    })
    const store = useWorkspacesStore()
    store.activeId = 'ux-ws'

    const alice = store.activateSpace('ux-ws', 'alice')
    await vi.waitFor(() => expect(switchMock).toHaveBeenCalledWith({ workspaceId: 'ux-ws', slug: 'alice' }))
    const bob = store.activateSpace('ux-ws', 'bob')
    await new Promise<void>(resolve => queueMicrotask(() => resolve()))
    expect(switchMock).toHaveBeenCalledTimes(1)

    firstSwitch.resolve({ ok: true, data: { externalInitWarnings: [] } })
    await Promise.all([alice, bob])

    expect(switchMock.mock.calls.map(([input]) => input.slug)).toEqual(['alice', 'bob'])
    expect(activeSlug).toBe('bob')
  })
})
