import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExternalRef, Workspace, WorkspaceScanResult } from '@shared/types'

const tmpUserData = await mkdtemp(join(tmpdir(), 'workspace-service-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

const syncWorkspaceTemplatesMock = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined))
vi.mock('./templates', () => ({
  syncWorkspaceTemplates: syncWorkspaceTemplatesMock
}))

const scanWorkspaceMock = vi.hoisted(() =>
  vi.fn(async (): Promise<WorkspaceScanResult> => ({
    kind: 'ux',
    warnings: [],
    assetLibraries: [],
    designSystemAssets: [],
    hasComponentsDir: true,
    hasDesignSystemsDir: false,
    hasAssetsDir: true,
    hasOutputsDir: true,
    personalSpace: null
  }))
)
vi.mock('./scanner', () => ({
  scanWorkspace: scanWorkspaceMock
}))

const lifecycleMocks = vi.hoisted(() => ({
  watcherActivate: vi.fn(async (): Promise<void> => undefined),
  watcherStopAll: vi.fn(async (): Promise<void> => undefined),
  bindAutoSave: vi.fn(),
  catchUpPush: vi.fn(async () => undefined),
  resumeWorkspaceSagas: vi.fn(async () => undefined),
  readGitCapability: vi.fn(async () => ({ state: 'unbound' as const })),
  ensureDefaultWorkspace: vi.fn(async () => workspace({
    id: 'default-workspace',
    kind: 'project',
    workflowMode: 'simple',
    isDefault: true,
    path: '/tmp/default-workspace'
  })),
  ensureDefaultKnowledgeWorkspace: vi.fn(async () => workspace({
    id: 'clips-workspace',
    kind: 'knowledge',
    name: '剪页库',
    path: '/tmp/clips'
  })),
}))

vi.mock('../projects/watcher', () => ({
  projectWatcher: {
    activate: lifecycleMocks.watcherActivate,
    stopAll: lifecycleMocks.watcherStopAll,
  },
}))
vi.mock('../saga/auto-save', () => ({
  bindAutoSave: lifecycleMocks.bindAutoSave,
  catchUpPush: lifecycleMocks.catchUpPush,
}))
vi.mock('../saga/service', () => ({
  resumeWorkspaceSagas: lifecycleMocks.resumeWorkspaceSagas,
}))
vi.mock('../git/capability', () => ({
  readGitCapability: lifecycleMocks.readGitCapability,
}))
vi.mock('./lifecycle', () => ({
  ensureDefaultWorkspace: lifecycleMocks.ensureDefaultWorkspace,
  ensureDefaultKnowledgeWorkspace: lifecycleMocks.ensureDefaultKnowledgeWorkspace,
}))

const externalMocks = vi.hoisted(() => ({
  list: vi.fn(async (): Promise<ExternalRef[]> => []),
  add: vi.fn(async () => ({
    id: 'clips-ref',
    alias: '剪页库',
    kind: 'local' as const,
    category: 'knowledge' as const,
    source: '/tmp/clips',
    poolPath: '/tmp/clips',
    addedAt: '2026-07-21T00:00:00.000Z'
  })),
  attach: vi.fn(async () => undefined),
}))
vi.mock('../external-pool/service', () => ({
  listExternalRefs: externalMocks.list,
  addExternalRef: externalMocks.add,
  attachExternalRef: externalMocks.attach,
}))

import {
  ensureDefaultWorkspace,
  awaitPendingWorkAreaSync,
  scan,
  setActiveWorkspace,
  setWorkspaceWatchScope,
  setWorkspaceWorkArea
} from './service'
import { workspacesJsonPath } from './paths'
import { _testOnlyResetSharedCache, WorkspacesStore } from './store'

function workspace(input: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ux-1',
    kind: 'ux',
    name: 'uikit',
    path: '/tmp/uikit',
    defaultBranch: 'main',
    addedAt: '2026-06-11T00:00:00.000Z',
    lastActiveAt: '2026-06-11T00:00:00.000Z',
    ...input
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('workspace service template sync', () => {
  beforeEach(async () => {
    _testOnlyResetSharedCache()
    syncWorkspaceTemplatesMock.mockClear()
    scanWorkspaceMock.mockClear()
    Object.values(lifecycleMocks).forEach((mock) => mock.mockClear())
    Object.values(externalMocks).forEach((mock) => mock.mockClear())
    lifecycleMocks.readGitCapability.mockResolvedValue({ state: 'unbound' })
    externalMocks.list.mockResolvedValue([])
    await fs.rm(workspacesJsonPath(), { force: true })
  })

  it('扫描已登记 UX 工作区时补齐 Claude 模板', async () => {
    const ws = workspace()
    await new WorkspacesStore().add(ws)

    await scan(ws.id)

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(ws.path, 'ux')
    expect(scanWorkspaceMock).toHaveBeenCalledWith(ws)
  })

  it('UX 工作区切换可写范围时同步 Claude 上下文', async () => {
    const ws = workspace({ id: 'ux-2' })
    await new WorkspacesStore().add(ws)

    await setWorkspaceWorkArea(ws.id, { kind: 'ui-product', relPath: 'outputs/login' })

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(ws.path, 'ux')
  })

  it('等待 work area 时会 drain 等待期间继续入队的更新', async () => {
    const ws = workspace({ id: 'ux-work-area-drain' })
    await new WorkspacesStore().add(ws)
    const firstGate = deferred()
    const secondGate = deferred()
    syncWorkspaceTemplatesMock
      .mockReturnValueOnce(firstGate.promise)
      .mockReturnValueOnce(secondGate.promise)

    const first = setWorkspaceWorkArea(ws.id, { kind: 'ui-product', relPath: 'outputs/first' })
    await vi.waitFor(() => expect(syncWorkspaceTemplatesMock).toHaveBeenCalledTimes(1))
    let drained = false
    const drain = awaitPendingWorkAreaSync(ws.id).then(() => { drained = true })
    const second = setWorkspaceWorkArea(ws.id, { kind: 'ui-product', relPath: 'outputs/second' })

    firstGate.resolve()
    await vi.waitFor(() => expect(syncWorkspaceTemplatesMock).toHaveBeenCalledTimes(2))
    expect(drained).toBe(false)

    secondGate.resolve()
    await Promise.all([first, second, drain])
    expect(drained).toBe(true)
  })

  it('激活未绑定 Git 的 simple Git 项目时不自动监听根目录', async () => {
    const ws = workspace({
      id: 'simple-1',
      kind: 'project',
      workflowMode: 'simple',
      isDefault: true,
    })
    await new WorkspacesStore().add(ws)

    await setActiveWorkspace(ws.id)

    expect(lifecycleMocks.watcherActivate).not.toHaveBeenCalled()
    expect(lifecycleMocks.readGitCapability).toHaveBeenCalledWith(ws.path)
    expect(lifecycleMocks.bindAutoSave).not.toHaveBeenCalled()
    expect(lifecycleMocks.resumeWorkspaceSagas).not.toHaveBeenCalled()
    expect(lifecycleMocks.catchUpPush).not.toHaveBeenCalled()
  })

  it.each(['project', 'ux'] as const)('按内部项目范围监听 %s 工作区', async (kind) => {
    const ws = workspace({ id: `${kind}-scope`, kind })
    await new WorkspacesStore().add(ws)

    await setWorkspaceWatchScope(ws.id, 'outputs/login')

    expect(lifecycleMocks.watcherActivate).toHaveBeenCalledWith(
      ws.id,
      ws.path,
      'outputs/login'
    )
    expect(lifecycleMocks.watcherStopAll).not.toHaveBeenCalled()
  })

  it('清空内部项目范围时停止全部监听', async () => {
    await setWorkspaceWatchScope(null, null)

    expect(lifecycleMocks.watcherStopAll).toHaveBeenCalledOnce()
    expect(lifecycleMocks.watcherActivate).not.toHaveBeenCalled()
  })

  it('拒绝监听不存在或不支持的工作区', async () => {
    await expect(setWorkspaceWatchScope('missing', 'outputs/login'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })

    const asset = workspace({ id: 'asset-scope', kind: 'asset' })
    await new WorkspacesStore().add(asset)
    await expect(setWorkspaceWatchScope(asset.id, 'outputs/login'))
      .rejects.toMatchObject({ code: 'VALIDATION' })
    expect(lifecycleMocks.watcherActivate).not.toHaveBeenCalled()
  })

  it('拒绝监听非当前 active workspace 的内部项目范围', async () => {
    const activeWorkspace = workspace({ id: 'scope-active', kind: 'project', isDefault: true })
    const staleWorkspace = workspace({ id: 'scope-stale', kind: 'project', isDefault: true })
    const workspaces = new WorkspacesStore()
    await workspaces.add(activeWorkspace)
    await workspaces.add(staleWorkspace)
    await workspaces.setActive(activeWorkspace.id)

    await expect(setWorkspaceWatchScope(staleWorkspace.id, 'outputs/stale'))
      .rejects.toMatchObject({ code: 'VALIDATION' })
    expect(lifecycleMocks.watcherActivate).not.toHaveBeenCalled()
  })

  it('scope 激活未完成时根 Git workspace 切换会等待并随后停止旧监听', async () => {
    const oldWorkspace = workspace({ id: 'scope-race-old', kind: 'project', isDefault: true })
    const nextWorkspace = workspace({ id: 'scope-race-next', kind: 'project', isDefault: true })
    const workspaces = new WorkspacesStore()
    await workspaces.add(oldWorkspace)
    await workspaces.add(nextWorkspace)
    await workspaces.setActive(oldWorkspace.id)
    const activateGate = deferred()
    lifecycleMocks.watcherActivate.mockReturnValueOnce(activateGate.promise)

    const scopePromise = setWorkspaceWatchScope(oldWorkspace.id, 'outputs/old')
    await vi.waitFor(() => expect(lifecycleMocks.watcherActivate).toHaveBeenCalledOnce())
    const switchPromise = setActiveWorkspace(nextWorkspace.id)
    await Promise.resolve()

    expect(lifecycleMocks.watcherStopAll).not.toHaveBeenCalled()
    activateGate.resolve()
    await Promise.all([scopePromise, switchPromise])

    expect(lifecycleMocks.watcherStopAll).toHaveBeenCalledOnce()
    await expect(workspaces.activeId()).resolves.toBe(nextWorkspace.id)
  })

  it('根 Git workspace 切换期间排队的旧 scope 请求不会复活 watcher', async () => {
    const oldWorkspace = workspace({ id: 'queued-stale-old', kind: 'project', isDefault: true })
    const nextWorkspace = workspace({ id: 'queued-stale-next', kind: 'project', isDefault: true })
    const workspaces = new WorkspacesStore()
    await workspaces.add(oldWorkspace)
    await workspaces.add(nextWorkspace)
    await workspaces.setActive(oldWorkspace.id)
    const stopGate = deferred()
    lifecycleMocks.watcherStopAll.mockReturnValueOnce(stopGate.promise)

    const switchPromise = setActiveWorkspace(nextWorkspace.id)
    await vi.waitFor(() => expect(lifecycleMocks.watcherStopAll).toHaveBeenCalledOnce())
    const staleScopePromise = setWorkspaceWatchScope(oldWorkspace.id, 'outputs/stale')
    const staleScopeRejected = expect(staleScopePromise)
      .rejects.toMatchObject({ code: 'VALIDATION' })

    stopGate.resolve()
    await Promise.all([switchPromise, staleScopeRejected])

    expect(lifecycleMocks.watcherActivate).not.toHaveBeenCalled()
    await expect(workspaces.activeId()).resolves.toBe(nextWorkspace.id)
  })

  it('切换根 Git workspace 时停止旧内部项目监听', async () => {
    const oldWorkspace = workspace({ id: 'root-old', kind: 'project', isDefault: true })
    const nextWorkspace = workspace({ id: 'root-next', kind: 'project', isDefault: true })
    const workspaces = new WorkspacesStore()
    await workspaces.add(oldWorkspace)
    await workspaces.add(nextWorkspace)
    await workspaces.setActive(oldWorkspace.id)

    await setActiveWorkspace(nextWorkspace.id)

    expect(lifecycleMocks.watcherStopAll).toHaveBeenCalledOnce()
  })

  it('清空根 Git workspace 时停止旧内部项目监听', async () => {
    const oldWorkspace = workspace({ id: 'root-to-null', kind: 'project', isDefault: false })
    const workspaces = new WorkspacesStore()
    await workspaces.add(oldWorkspace)
    for (const existing of await workspaces.list()) {
      if (existing.id !== oldWorkspace.id) await workspaces.remove(existing.id)
    }
    await workspaces.setActive(oldWorkspace.id)

    await setActiveWorkspace(null)

    expect(lifecycleMocks.watcherStopAll).toHaveBeenCalledOnce()
    await expect(workspaces.activeId()).resolves.toBeNull()
  })

  it('重复激活同一根 Git workspace 时保留现有监听', async () => {
    const ws = workspace({ id: 'root-current', kind: 'project', isDefault: true })
    const workspaces = new WorkspacesStore()
    await workspaces.add(ws)
    await workspaces.setActive(ws.id)

    await setActiveWorkspace(ws.id)

    expect(lifecycleMocks.watcherStopAll).not.toHaveBeenCalled()
  })

  it('初始化本地工作台时自动创建并绑定剪页库资源', async () => {
    const result = await ensureDefaultWorkspace()

    expect(lifecycleMocks.ensureDefaultKnowledgeWorkspace).toHaveBeenCalledOnce()
    expect(externalMocks.add).toHaveBeenCalledWith({
      alias: '剪页库',
      category: 'knowledge',
      kind: 'local',
      sourcePath: '/tmp/clips'
    })
    expect(externalMocks.attach).toHaveBeenCalledWith('default-workspace', 'clips-ref')
    expect(result.id).toBe('default-workspace')
  })

  it('已有剪页资源时直接复用，不重复注册', async () => {
    externalMocks.list.mockResolvedValue([{
      id: 'existing-clips-ref',
      alias: '剪页库',
      kind: 'local',
      category: 'knowledge',
      source: '/tmp/clips',
      poolPath: '/tmp/clips',
      addedAt: '2026-07-20T00:00:00.000Z'
    }])

    await ensureDefaultWorkspace()

    expect(externalMocks.add).not.toHaveBeenCalled()
    expect(externalMocks.attach).toHaveBeenCalledWith('default-workspace', 'existing-clips-ref')
  })
})
