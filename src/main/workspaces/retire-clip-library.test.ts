import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspaces: vi.fn(), refs: vi.fn(), detach: vi.fn(), remove: vi.fn(), settings: vi.fn(), update: vi.fn()
}))
vi.mock('./store', () => ({ WorkspacesStore: class { list = mocks.workspaces } }))
vi.mock('../external-pool/store', () => ({ externalPoolStore: { list: mocks.refs } }))
vi.mock('../external-pool/service', () => ({ detachExternalRef: mocks.detach, removeExternalRef: mocks.remove }))
vi.mock('../settings/store', () => ({ settingsStore: { get: mocks.settings, update: mocks.update } }))
import { retireLegacyClipLibrary } from './retire-clip-library'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspaces.mockResolvedValue([{ id: 'clips', kind: 'knowledge', name: '剪页库', path: '/clips' }, { id: 'repo-a', kind: 'project' }, { id: 'repo-b', kind: 'project' }])
  mocks.refs.mockResolvedValue([{ id: 'old', kind: 'local', source: '/clips' }, { id: 'other', kind: 'local', source: '/documents' }])
  mocks.settings.mockResolvedValue({ defaultExternalRefIds: ['old', 'other'] })
})

describe('retiring the automatic clip resource', () => {
  it('detaches the old library from all repositories and preserves unrelated default resources', async () => {
    await retireLegacyClipLibrary()
    expect(mocks.detach.mock.calls).toEqual([['repo-a', 'old'], ['repo-b', 'old']])
    expect(mocks.remove.mock.calls).toEqual([['old']])
    expect(mocks.update).toHaveBeenCalledWith({ defaultExternalRefIds: ['other'] })
  })
  it('does not match a user knowledge library by alias alone', async () => {
    mocks.workspaces.mockResolvedValue([{ id: 'knowledge', kind: 'knowledge', name: '团队知识库', path: '/documents' }])
    await retireLegacyClipLibrary()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('is safe to run again after the clip reference has been removed', async () => {
    mocks.refs.mockResolvedValue([])
    await retireLegacyClipLibrary()
    expect(mocks.detach).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
