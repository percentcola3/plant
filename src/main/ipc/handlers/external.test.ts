import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerIpcHandlerMock = vi.hoisted(() => vi.fn())
const hydrateExternalManifestMock = vi.hoisted(() =>
  vi.fn(async () => ({ mounted: ['ui'], warnings: [] as string[] }))
)
const readExternalRefSyncStatusMock = vi.hoisted(() =>
  vi.fn(async (id: string) => ({
    externalRefId: id,
    kind: 'git' as const,
    ok: true,
    hasUpdates: true,
    behind: 1,
    checkedAt: '2026-06-11T00:00:00.000Z'
  }))
)
const switchExternalRefCheckoutMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'ref-1',
    alias: 'kb',
    kind: 'git' as const,
    category: 'knowledge' as const,
    source: 'https://example.com/kb.git',
    poolPath: '/pool/ref-1',
    addedAt: '2026-06-11T00:00:00.000Z',
    checkout: { type: 'branch' as const, value: 'docs' }
  }))
)
const updateExternalRefBindingMock = vi.hoisted(() =>
  vi.fn(async () => ({
    alias: 'kb',
    externalRefId: 'ref-1',
    addedAt: '2026-06-11T00:00:00.000Z',
    visibleDirs: ['docs']
  }))
)
const listExternalRefBranchesMock = vi.hoisted(() =>
  vi.fn(async (id: string) => ({
    externalRefId: id,
    branches: ['main', 'release/docs'],
    current: 'main',
    checkedAt: '2026-06-12T00:00:00.000Z'
  }))
)
const requestExternalRefIndexBuildMock = vi.hoisted(() =>
  vi.fn(async (id: string) => ({
    externalRefId: id,
    state: 'queued' as const,
    reason: 'manual' as const,
    updatedAt: '2026-07-21T00:00:00.000Z'
  }))
)

vi.mock('../registry', () => ({
  registerIpcHandler: registerIpcHandlerMock
}))

vi.mock('../../external-pool/service', () => ({
  addExternalRef: vi.fn(),
  attachExternalRef: vi.fn(),
  detachExternalRef: vi.fn(),
  hydrateExternalManifest: hydrateExternalManifestMock,
  listExternalRefBranches: listExternalRefBranchesMock,
  listExternalRefs: vi.fn(),
  readExternalRefSyncStatus: readExternalRefSyncStatusMock,
  refreshExternalRef: vi.fn(),
  requestExternalRefIndexBuild: requestExternalRefIndexBuildMock,
  removeExternalRef: vi.fn(),
  switchExternalRefCheckout: switchExternalRefCheckoutMock,
  updateExternalRefBinding: updateExternalRefBindingMock
}))

import { registerExternalHandlers } from './external'

beforeEach(() => {
  registerIpcHandlerMock.mockClear()
  hydrateExternalManifestMock.mockClear()
  readExternalRefSyncStatusMock.mockClear()
  switchExternalRefCheckoutMock.mockClear()
  updateExternalRefBindingMock.mockClear()
  listExternalRefBranchesMock.mockClear()
  requestExternalRefIndexBuildMock.mockClear()
})

describe('registerExternalHandlers', () => {
  it('注册手动更新工作区外联入口', async () => {
    registerExternalHandlers()

    const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'external.hydrate')
    expect(entry).toBeTruthy()

    const handler = entry?.[1]
    await expect(handler({ workspaceId: 'ws-1' })).resolves.toEqual({
      mounted: ['ui'],
      warnings: []
    })
    expect(hydrateExternalManifestMock).toHaveBeenCalledWith('ws-1')
  })

  it('注册外部库远端状态检测入口', async () => {
    registerExternalHandlers()

    const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'external.status')
    expect(entry).toBeTruthy()

    const handler = entry?.[1]
    await expect(handler({ id: 'ref-1' })).resolves.toMatchObject({
      externalRefId: 'ref-1',
      ok: true,
      hasUpdates: true,
      behind: 1
    })
    expect(readExternalRefSyncStatusMock).toHaveBeenCalledWith('ref-1', { interactive: false })
  })

  it('注册外部 git 库 checkout 切换入口', async () => {
    registerExternalHandlers()

    const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'external.checkout')
    expect(entry).toBeTruthy()

    const handler = entry?.[1]
    await expect(handler({
      id: 'ref-1',
      checkout: { type: 'branch', value: 'docs' }
    })).resolves.toMatchObject({
      id: 'ref-1',
      checkout: { type: 'branch', value: 'docs' }
    })
    expect(switchExternalRefCheckoutMock).toHaveBeenCalledWith('ref-1', { type: 'branch', value: 'docs' })
  })

  it('注册项目外部库目录筛选更新入口', async () => {
    registerExternalHandlers()

    const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'external.updateBinding')
    expect(entry).toBeTruthy()

    const handler = entry?.[1]
    await expect(handler({
      workspaceId: 'ws-1',
      externalRefId: 'ref-1',
      visibleDirs: ['docs']
    })).resolves.toMatchObject({
      externalRefId: 'ref-1',
      visibleDirs: ['docs']
    })
    expect(updateExternalRefBindingMock).toHaveBeenCalledWith('ws-1', 'ref-1', { visibleDirs: ['docs'] })
  })

  it('注册外部 git 库远端分支列表入口', async () => {
    registerExternalHandlers()

    const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'external.branches')
    expect(entry).toBeTruthy()

    const handler = entry?.[1]
    await expect(handler({ id: 'ref-1' })).resolves.toEqual({
      externalRefId: 'ref-1',
      branches: ['main', 'release/docs'],
      current: 'main',
      checkedAt: '2026-06-12T00:00:00.000Z'
    })
    expect(listExternalRefBranchesMock).toHaveBeenCalledWith('ref-1')
  })

  it('注册手动构建资源索引入口', async () => {
    registerExternalHandlers()

    const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'external.buildIndex')
    expect(entry).toBeTruthy()

    const handler = entry?.[1]
    await expect(handler({ id: 'ref-1' })).resolves.toMatchObject({
      externalRefId: 'ref-1',
      state: 'queued',
      reason: 'manual'
    })
    expect(requestExternalRefIndexBuildMock).toHaveBeenCalledWith('ref-1')
  })
})
