import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerIpcHandlerMock = vi.hoisted(() => vi.fn())
const setWorkspaceWatchScopeMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../registry', () => ({
  registerIpcHandler: registerIpcHandlerMock
}))
vi.mock('../../workspaces/lifecycle', () => ({
  cloneWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  importWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  renameWorkspace: vi.fn()
}))
vi.mock('../../requirements/lifecycle', () => ({
  checkoutProjectHome: vi.fn()
}))
vi.mock('../../workspaces/sync', () => ({
  saveWorkspace: vi.fn(),
  syncWorkspace: vi.fn()
}))
vi.mock('../../workspaces/team-push', () => ({
  abortTeamPush: vi.fn(),
  pushToTeamSpace: vi.fn()
}))
vi.mock('../../workspaces/service', () => ({
  setWorkspaceWatchScope: setWorkspaceWatchScopeMock,
  setWorkspaceWorkArea: vi.fn()
}))
vi.mock('../../workspaces/personal-space', () => ({
  createPersonalSpace: vi.fn(),
  ensurePersonalSpace: vi.fn(),
  listPersonalSpaces: vi.fn(),
  readPersonalSpace: vi.fn(),
  removePersonalSpace: vi.fn(),
  switchPersonalSpace: vi.fn()
}))
vi.mock('../../features/lifecycle', () => ({
  createFeature: vi.fn(),
  deleteFeature: vi.fn(),
  importFeature: vi.fn(),
  moveFeature: vi.fn(),
  renameFeature: vi.fn()
}))
vi.mock('../../features/copy-to-space', () => ({
  copyFeatureToSpace: vi.fn()
}))
vi.mock('../../features/scanner', () => ({
  listFeatureGroups: vi.fn(),
  listFeatures: vi.fn()
}))
vi.mock('../../workspaces/store', () => ({
  WorkspacesStore: class {
    findById = vi.fn()
  }
}))
vi.mock('../../workspaces/conflict', () => ({
  abortOperation: vi.fn(),
  applyResolution: vi.fn(),
  continueOperation: vi.fn(),
  listConflicts: vi.fn(),
  pickSide: vi.fn()
}))
vi.mock('../../conflict/ai-resolve', () => ({
  abortAiResolve: vi.fn(),
  startAiResolve: vi.fn()
}))
vi.mock('../../external-pool/service', () => ({
  listExternalRefs: vi.fn(),
  readFeatureExternalRefs: vi.fn(),
  updateFeatureExternalRefs: vi.fn()
}))
vi.mock('../../settings/store', () => ({
  settingsStore: {}
}))

import { registerWorkspaceWriteHandlers } from './workspace-write'

function watchScopeHandler(): (input: unknown) => Promise<void> {
  registerWorkspaceWriteHandlers()
  const entry = registerIpcHandlerMock.mock.calls.find(
    ([channel]) => channel === 'workspace.setWatchScope'
  )
  expect(entry).toBeTruthy()
  return entry![1]
}

beforeEach(() => {
  registerIpcHandlerMock.mockClear()
  setWorkspaceWatchScopeMock.mockClear()
})

describe('workspace.setWatchScope handler', () => {
  it('转发设置与清空监听范围', async () => {
    const handler = watchScopeHandler()

    await handler({ workspaceId: 'ws-1', projectRelPath: 'outputs/login' })
    await handler({ workspaceId: null, projectRelPath: null })

    expect(setWorkspaceWatchScopeMock).toHaveBeenNthCalledWith(
      1,
      'ws-1',
      'outputs/login'
    )
    expect(setWorkspaceWatchScopeMock).toHaveBeenNthCalledWith(2, null, null)
  })

  it.each([
    { workspaceId: 'ws-1', projectRelPath: null },
    { workspaceId: null, projectRelPath: 'outputs/login' },
    { workspaceId: '', projectRelPath: 'outputs/login' },
    { workspaceId: 'ws-1', projectRelPath: '' }
  ])('拒绝不完整的监听范围：$workspaceId / $projectRelPath', async (input) => {
    const handler = watchScopeHandler()

    await expect(handler(input)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(setWorkspaceWatchScopeMock).not.toHaveBeenCalled()
  })
})
