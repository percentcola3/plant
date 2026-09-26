import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpUserData = await mkdtemp(join(tmpdir(), 'personal-space-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

// git client mock：每个 case 在 beforeEach 重置返回值。
type GitStatusMock = { isClean: () => boolean; current: string; files: Array<{ path: string; index?: string; working_dir?: string }> }
const gitApi = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  status: vi.fn(async (): Promise<GitStatusMock> => ({ isClean: () => true, current: 'main', files: [] })),
  checkout: vi.fn(async () => undefined),
  checkoutBranch: vi.fn(async () => undefined),
  branchLocal: vi.fn(async (): Promise<{ all: string[]; current: string }> => ({ all: ['main'], current: 'main' })),
  raw: vi.fn(async (_args: string[]): Promise<string> => ''),
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  revparse: vi.fn(async () => 'abc123')
}))
vi.mock('../git/client', () => ({
  gitFor: vi.fn(() => gitApi),
  gitForWithAskpass: vi.fn(async () => gitApi)
}))

// identity mock：默认 user.name 兜底 + sanitize 透传
vi.mock('../git/identity', () => ({
  readLocalGitUser: vi.fn(async () => ({ name: 'alice', email: 'a@b.com' })),
  sanitizeBranchSegment: vi.fn((raw: string) => raw.trim().toLowerCase() || 'work')
}))

const syncWorkspaceTemplatesMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./templates', () => ({
  syncWorkspaceTemplates: syncWorkspaceTemplatesMock
}))

const hydrateExternalManifestMock = vi.hoisted(() => vi.fn(async () => ({ mounted: [], warnings: [] as string[] })))
vi.mock('../external-pool/service', () => ({
  hydrateExternalManifest: hydrateExternalManifestMock
}))

import { createWorkspace } from './lifecycle'
import {
  createPersonalSpace,
  ensurePersonalSpace,
  listPersonalSpaces,
  readPersonalSpace,
  removePersonalSpace,
  switchPersonalSpace
} from './personal-space'
import { _testOnlyResetSharedCache, WorkspacesStore } from './store'
import { workspacesJsonPath, personalSpacePath } from './paths'
import { _testOnlyResetSharedProbe } from '../git/probe'
import { UIClientError } from '../ipc/errors'

let parentDir: string

beforeEach(async () => {
  _testOnlyResetSharedCache()
  _testOnlyResetSharedProbe()
  // 清除调用历史（mockClear 保留实现），避免跨用例泄漏导致断言误报
  Object.values(gitApi).forEach((m) => (m as { mockClear: () => void }).mockClear())
  gitApi.init.mockResolvedValue(undefined)
  gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })
  gitApi.checkout.mockResolvedValue(undefined)
  gitApi.checkoutBranch.mockResolvedValue(undefined)
  gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
  gitApi.raw.mockResolvedValue('')
  gitApi.add.mockResolvedValue(undefined)
  gitApi.commit.mockResolvedValue(undefined)
  gitApi.push.mockResolvedValue(undefined)
  gitApi.revparse.mockResolvedValue('abc123')
  hydrateExternalManifestMock.mockClear()
  hydrateExternalManifestMock.mockResolvedValue({ mounted: [], warnings: [] })
  await fs.rm(workspacesJsonPath(), { force: true })
  parentDir = await mkdtemp(join(tmpdir(), 'personal-space-'))
})

async function makeUxWorkspace(): Promise<{ id: string; path: string }> {
  const ws = await createWorkspace({ parentDir, name: 'ux-demo', kind: 'ux' })
  await new WorkspacesStore().updateWorkspace(ws.id, { workflowMode: undefined })
  return { id: ws.id, path: ws.path }
}

describe('personal space lifecycle', () => {
  it('rejects personal spaces for simple projects before touching Git', async () => {
    const ws = await createWorkspace({ parentDir, name: 'simple-project' })

    await expect(listPersonalSpaces(ws.id)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: '简化项目不使用个人空间',
    })
    expect(gitApi.status).not.toHaveBeenCalled()
  })

  it('creates a space/<slug> branch from default branch and writes meta on first ensure', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })

    const space = await ensurePersonalSpace({ workspaceId: id, slug: 'eric' })

    expect(space).toMatchObject({ slug: 'eric', branch: 'space/eric' })
    expect(gitApi.checkoutBranch).not.toHaveBeenCalled()
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      '-b',
      'space/eric',
      join(tmpUserData, 'personal-space-worktrees', id, 'eric'),
      'main'
    ])
    // meta 文件写入
    const ws = await new WorkspacesStore().findById(id)
    await expect(fs.readFile(personalSpacePath(ws!.path), 'utf-8')).resolves.toContain('space/eric')
  })

  it('is idempotent: returns existing space without switching when already on it', async () => {
    const { id, path } = await makeUxWorkspace()
    // 预置一份已存在的 meta
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({ slug: 'bob', branch: 'space/bob', createdAt: '2026-01-01T00:00:00.000Z' }),
      'utf-8'
    )
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/bob'], current: 'main' })
    // 已在 space/bob 上：幂等路径直接返回，不做任何 checkout
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/bob', files: [] })

    const space = await ensurePersonalSpace({ workspaceId: id })

    expect(space).toMatchObject({ slug: 'bob', branch: 'space/bob' })
    expect(gitApi.checkout).not.toHaveBeenCalled()
    expect(gitApi.checkoutBranch).not.toHaveBeenCalled()
  })

  it('creates and pushes an explicitly requested space when another space is active', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({
        spaces: [{ slug: 'alice', branch: 'space/alice', createdAt: '2026-01-01T00:00:00.000Z' }],
        activeSlug: 'alice'
      }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/alice', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/alice'], current: 'space/alice' })
    gitApi.raw.mockImplementation(async (args: string[]) => args[0] === 'remote' ? 'origin\n' : '')

    const space = await ensurePersonalSpace({ workspaceId: id, slug: 'ux-shared' })

    expect(space).toMatchObject({ slug: 'ux-shared', branch: 'space/ux-shared' })
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      '-b',
      'space/ux-shared',
      join(tmpUserData, 'personal-space-worktrees', id, 'ux-shared'),
      'main'
    ])
    expect(gitApi.push).toHaveBeenCalledWith(['-u', 'origin', 'space/ux-shared'])
  })

  it('fetches and switches to the requested remote space instead of recreating it', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    let fetched = false
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'ls-remote') return 'abc123\trefs/heads/space/ux-shared\n'
      if (args[0] === 'fetch') {
        fetched = true
        return ''
      }
      if (args[0] === 'for-each-ref') {
        return fetched ? 'origin/space/ux-shared\n' : ''
      }
      if (args[0] === 'show-ref') return ''
      return ''
    })

    const space = await ensurePersonalSpace({ workspaceId: id, slug: 'ux-shared' })

    expect(space).toMatchObject({ slug: 'ux-shared', branch: 'space/ux-shared' })
    expect(gitApi.raw).toHaveBeenCalledWith([
      'fetch',
      'origin',
      'space/ux-shared:refs/remotes/origin/space/ux-shared'
    ])
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      '-b',
      'space/ux-shared',
      join(tmpUserData, 'personal-space-worktrees', id, 'ux-shared'),
      'origin/space/ux-shared'
    ])
    expect(gitApi.push).not.toHaveBeenCalled()
  })

  it('pushes an existing requested local space when the remote branch is missing', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({
        spaces: [{ slug: 'ux-shared', branch: 'space/ux-shared', createdAt: '2026-01-01T00:00:00.000Z' }],
        activeSlug: 'ux-shared'
      }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/ux-shared', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/ux-shared'], current: 'space/ux-shared' })
    gitApi.raw.mockImplementation(async (args: string[]) => args[0] === 'remote' ? 'origin\n' : '')

    const space = await ensurePersonalSpace({ workspaceId: id, slug: 'ux-shared' })

    expect(space).toMatchObject({ slug: 'ux-shared', branch: 'space/ux-shared' })
    expect(gitApi.raw).toHaveBeenCalledWith(['ls-remote', '--heads', 'origin', 'space/ux-shared'])
    expect(gitApi.push).toHaveBeenCalledWith(['-u', 'origin', 'space/ux-shared'])
  })

  it('uses git user.name as default slug when slug omitted', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/alice', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })

    const space = await ensurePersonalSpace({ workspaceId: id })

    expect(space.slug).toBe('alice')
    expect(space.branch).toBe('space/alice')
  })

  it('rejects asset / knowledge workspaces (PM + UX 共用，其它 kind 拒绝)', async () => {
    const ws = await createWorkspace({ parentDir, name: 'kb-demo', kind: 'knowledge' })
    await expect(ensurePersonalSpace({ workspaceId: ws.id })).rejects.toThrow(UIClientError)
  })

  it('readPersonalSpace returns public space when on default branch without personal meta', async () => {
    const { id } = await makeUxWorkspace()
    const result = await readPersonalSpace(id)
    expect(result).toMatchObject({
      isPublic: true,
      displayName: '私密空间',
      branch: 'main'
    })
  })

  it('creates a personal-space worktree without checking out even when the current worktree is dirty', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.status.mockResolvedValue({ isClean: () => false, current: 'main', files: [{ path: 'outputs/x.html' }] })

    const space = await ensurePersonalSpace({ workspaceId: id })

    expect(space).toMatchObject({ slug: 'alice', branch: 'space/alice' })
    expect(gitApi.checkout).not.toHaveBeenCalled()
    expect(gitApi.checkoutBranch).not.toHaveBeenCalled()
  })

  it('also allows PM project workspaces (kind=project)', async () => {
    const ws = await createWorkspace({ parentDir, name: 'pm-demo', kind: 'project' })
    await new WorkspacesStore().updateWorkspace(ws.id, { workflowMode: undefined })
    gitApi.status.mockImplementation(async () => ({ isClean: () => true, current: 'space/eric', files: [] }))
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    const space = await ensurePersonalSpace({ workspaceId: ws.id, slug: 'eric' })
    expect(space.branch).toBe('space/eric')
  })
})

describe('multi-space behavior', () => {
  it('lists all spaces and tracks activeSlug', async () => {
    const { id } = await makeUxWorkspace()
    // 第一个 space
    let count = 0
    gitApi.status.mockImplementation(async () => ({
      isClean: () => true,
      current: ++count <= 2 ? 'main' : 'space/alice',
      files: []
    }))
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    await createPersonalSpace({ workspaceId: id, slug: 'alice' })

    // 第二个 space — 切回 main 再 cut
    count = 0
    gitApi.status.mockImplementation(async () => ({
      isClean: () => true,
      current: ++count <= 2 ? 'space/alice' : 'space/bob',
      files: []
    }))
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/alice'], current: 'space/alice' })
    await createPersonalSpace({ workspaceId: id, slug: 'bob' })

    gitApi.branchLocal.mockResolvedValue({
      all: ['main', 'space/alice', 'space/bob'],
      current: 'space/bob'
    })
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/bob', files: [] })
    const list = await listPersonalSpaces(id)
    expect(list.spaces.map((s) => s.displayName ?? s.slug)).toEqual(['私密空间', 'alice', 'bob'])
    expect(list.activeSlug).toBe('bob')
  })

  it('marks public space active when current branch is the default branch', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({
        spaces: [{ slug: 'a', branch: 'space/a', createdAt: '2026-01-01T00:00:00.000Z' }],
        activeSlug: 'a'
      }),
      'utf-8'
    )
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/a'], current: 'main' })
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })

    const list = await listPersonalSpaces(id)

    expect(list.activeSlug).toBe('__public__')
    expect(list.spaces[0]).toMatchObject({
      slug: '__public__',
      branch: 'main',
      displayName: '私密空间',
      isPublic: true
    })
  })

  it('createPersonalSpace fromBranch uses given branch as base', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'feature-x'], current: 'main' })
    await createPersonalSpace({ workspaceId: id, slug: 'feature', fromBranch: 'feature-x' })
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      '-b',
      'space/feature',
      join(tmpUserData, 'personal-space-worktrees', id, 'feature'),
      'feature-x'
    ])
  })

  it('createPersonalSpace rejects when fromBranch missing', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    await expect(
      createPersonalSpace({ workspaceId: id, slug: 'feature', fromBranch: 'ghost' })
    ).rejects.toMatchObject({ code: 'GIT_FAILED' })
  })

  it('switchPersonalSpace updates activeSlug', async () => {
    const { id, path } = await makeUxWorkspace()
    // 预置 meta：两个 space
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      join(path, '.ui-client/personal-space.json'),
      JSON.stringify({
        spaces: [
          { slug: 'a', branch: 'space/a', createdAt: '2026-01-01T00:00:00.000Z' },
          { slug: 'b', branch: 'space/b', createdAt: '2026-01-02T00:00:00.000Z' }
        ],
        activeSlug: 'a'
      }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/a', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/a', 'space/b'], current: 'space/a' })

    const after = await switchPersonalSpace({ workspaceId: id, slug: 'b' })
    expect(after.slug).toBe('b')
    expect(gitApi.checkout).not.toHaveBeenCalledWith('space/b')
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      join(tmpUserData, 'personal-space-worktrees', id, 'b'),
      'space/b'
    ])
    await expect(new WorkspacesStore().findById(id))
      .resolves.toMatchObject({ path: join(tmpUserData, 'personal-space-worktrees', id, 'b') })
  })

  it('switchPersonalSpace can switch to the public default branch', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({
        spaces: [{ slug: 'a', branch: 'space/a', createdAt: '2026-01-01T00:00:00.000Z' }],
        activeSlug: 'a'
      }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/a', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/a'], current: 'space/a' })

    const after = await switchPersonalSpace({ workspaceId: id, slug: '__public__' })

    expect(after).toMatchObject({ isPublic: true, branch: 'main', displayName: '私密空间' })
    expect(gitApi.checkout).not.toHaveBeenCalledWith('main')
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      join(tmpUserData, 'personal-space-worktrees', id, '__public__'),
      'main'
    ])
  })

  it('removePersonalSpace deletes branch + clears meta', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      join(path, '.ui-client/personal-space.json'),
      JSON.stringify({
        spaces: [{ slug: 'old', branch: 'space/old', createdAt: '2026-01-01T00:00:00.000Z' }],
        activeSlug: 'old'
      }),
      'utf-8'
    )
    // 当前不在 space/old 上（无需切 main）
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/old'], current: 'main' })

    const next = await removePersonalSpace({ workspaceId: id, slug: 'old' })
    expect(gitApi.raw).toHaveBeenCalledWith(['branch', '-D', 'space/old'])
    expect(next.spaces).toHaveLength(1)
    expect(next.spaces[0]).toMatchObject({ isPublic: true, branch: 'main' })
    expect(next.activeSlug).toBe('__public__')
  })

  it('removePersonalSpace rejects public space', async () => {
    const { id } = await makeUxWorkspace()
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main', files: [] })

    await expect(
      removePersonalSpace({ workspaceId: id, slug: '__public__' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('external hydrate after create/switch', () => {
  it('createPersonalSpace triggers hydrateExternalManifest', async () => {
    const { id } = await makeUxWorkspace()
    let count = 0
    gitApi.status.mockImplementation(async () => ({
      isClean: () => true,
      current: ++count <= 2 ? 'main' : 'space/eric',
      files: []
    }))
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })

    await createPersonalSpace({ workspaceId: id, slug: 'eric' })

    expect(hydrateExternalManifestMock).toHaveBeenCalledWith(id)
  })

  it('switchPersonalSpace triggers hydrate after worktree switch', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({
        spaces: [
          { slug: 'a', branch: 'space/a', createdAt: '2026-01-01T00:00:00.000Z' },
          { slug: 'b', branch: 'space/b', createdAt: '2026-01-02T00:00:00.000Z' }
        ],
        activeSlug: 'a'
      }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/a', files: [] })
    gitApi.branchLocal.mockResolvedValue({ all: ['main', 'space/a', 'space/b'], current: 'space/a' })

    await switchPersonalSpace({ workspaceId: id, slug: 'b' })

    expect(hydrateExternalManifestMock).toHaveBeenCalledWith(id)
  })

  it('switchPersonalSpace triggers hydrate even when already on target branch', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      personalSpacePath(path),
      JSON.stringify({
        spaces: [{ slug: 'a', branch: 'space/a', createdAt: '2026-01-01T00:00:00.000Z' }],
        activeSlug: 'a'
      }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/a', files: [] })

    await switchPersonalSpace({ workspaceId: id, slug: 'a' })

    expect(hydrateExternalManifestMock).toHaveBeenCalledWith(id)
    expect(gitApi.checkout).not.toHaveBeenCalled()
  })

  it('exposes hydrate warnings via externalInitWarnings on returned space', async () => {
    const { id } = await makeUxWorkspace()
    let count = 0
    gitApi.status.mockImplementation(async () => ({
      isClean: () => true,
      current: ++count <= 2 ? 'main' : 'space/eric',
      files: []
    }))
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    hydrateExternalManifestMock.mockResolvedValue({
      mounted: [],
      warnings: ['外部依赖 ui 初始化失败：no creds']
    })

    const space = await createPersonalSpace({ workspaceId: id, slug: 'eric' })

    expect(space.externalInitWarnings).toEqual(['外部依赖 ui 初始化失败：no creds'])
  })

  it('hydrate exceptions are caught and surfaced as a warning, not thrown', async () => {
    const { id } = await makeUxWorkspace()
    let count = 0
    gitApi.status.mockImplementation(async () => ({
      isClean: () => true,
      current: ++count <= 2 ? 'main' : 'space/eric',
      files: []
    }))
    gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    hydrateExternalManifestMock.mockRejectedValue(new Error('boom'))

    const space = await createPersonalSpace({ workspaceId: id, slug: 'eric' })

    expect(space.externalInitWarnings).toEqual(['外部依赖初始化失败：boom'])
  })
})

describe('meta format migration', () => {
  it('reads old single-entry format and presents as list', async () => {
    const { id, path } = await makeUxWorkspace()
    await fs.mkdir(join(path, '.ui-client'), { recursive: true })
    await fs.writeFile(
      join(path, '.ui-client/personal-space.json'),
      JSON.stringify({ slug: 'legacy', branch: 'space/legacy', createdAt: '2026-01-01T00:00:00.000Z' }),
      'utf-8'
    )
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'space/legacy', files: [] })

    const list = await listPersonalSpaces(id)
    expect(list.spaces).toHaveLength(2)
    expect(list.spaces[0]).toMatchObject({ slug: '__public__', displayName: '私密空间', isPublic: true })
    expect(list.activeSlug).toBe('legacy')
  })
})
