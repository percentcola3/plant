import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(), onChange: vi.fn(), dispose: vi.fn(), capability: vi.fn(), dispatch: vi.fn(),
  find: vi.fn(async () => ({ id: 'ws', path: '/repo', defaultBranch: 'main' })), snapshot: vi.fn()
}))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] } }))
vi.mock('../workspaces/store', () => ({ WorkspacesStore: class {
  findById = mocks.find
  activeId = async () => 'ws'
} }))
vi.mock('../projects/watcher', () => ({ projectWatcher: { onChange: mocks.onChange } }))
vi.mock('../git/capability', () => ({ readGitCapability: mocks.capability }))
vi.mock('./service', () => ({ dispatchSaga: mocks.dispatch }))
vi.mock('../git/probe', () => ({ getSharedProbe: () => ({ snapshot: mocks.snapshot }) }))

import { bindAutoSave, catchUpPush, flushBeforeQuit, readAutoSyncStatus, setAutoSyncStatus, syncIncomingChanges, unbindAll } from './auto-save'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.onChange.mockReturnValue(mocks.dispose)
  mocks.capability.mockResolvedValue({ state: 'remote', branch: 'main', remoteUrl: '/remote' })
  mocks.dispatch.mockResolvedValue({ status: 'done', steps: [] })
  setAutoSyncStatus('ws', { state: 'idle' })
})
afterEach(() => { unbindAll(); vi.useRealTimers() })

describe('automatic Git sync', () => {
  it('pulls incoming commits after background fetch only when the working tree is clean', async () => {
    mocks.snapshot.mockResolvedValueOnce({ working: { kind: 'dirty' }, remote: { kind: 'tracked', incoming: 1 } })
    await syncIncomingChanges('ws')
    expect(mocks.dispatch).not.toHaveBeenCalled()
    mocks.snapshot.mockResolvedValueOnce({ working: { kind: 'clean' }, remote: { kind: 'tracked', incoming: 1 } })
    await syncIncomingChanges('ws')
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ intent: 'sync', args: { mode: 'remote', uncommittedStrategy: 'reject' } }))
  })
  it('debounces edits and dispatches a bidirectional sync for remote repositories', async () => {
    bindAutoSave('ws')
    const changed = mocks.onChange.mock.calls[0][1]
    changed()
    await vi.advanceTimersByTimeAsync(4_000)
    changed()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'sync', args: { mode: 'remote', uncommittedStrategy: 'commit' }, trigger: 'fs-change'
    }))
    expect(readAutoSyncStatus('ws')).toMatchObject({ state: 'idle', lastSyncedAt: expect.any(String) })
  })

  it('only commits in local Git directories and skips unbound directories', async () => {
    mocks.capability.mockResolvedValueOnce({ state: 'local', branch: 'main' })
    await catchUpPush('ws')
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'save', args: { release: false, pushAfter: false }
    }))
    mocks.dispatch.mockClear()
    mocks.capability.mockResolvedValueOnce({ state: 'unbound' })
    await catchUpPush('ws')
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('shows failed automatic sync and recovers on the next successful attempt', async () => {
    mocks.dispatch.mockResolvedValueOnce({ status: 'paused-for-user', steps: [] })
    await catchUpPush('ws')
    expect(readAutoSyncStatus('ws')).toMatchObject({ state: 'error' })
    await catchUpPush('ws')
    expect(readAutoSyncStatus('ws')).toMatchObject({ state: 'idle' })
    expect(mocks.send).toHaveBeenCalledWith('git.auto-sync-status:ws', expect.objectContaining({ state: 'error' }))
  })

  it('keeps thrown network failures visible instead of reporting an idle state', async () => {
    mocks.dispatch.mockRejectedValueOnce(new Error('network unavailable'))
    await catchUpPush('ws')
    expect(readAutoSyncStatus('ws')).toMatchObject({ state: 'error', message: 'network unavailable' })
  })

  it('cancels pending sync and commits without network access before quit', async () => {
    bindAutoSave('ws')
    mocks.onChange.mock.calls[0][1]()
    await flushBeforeQuit()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ intent: 'save', args: { release: false, pushAfter: false }, trigger: 'before-quit' }))
  })
})
