import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpUserData = await mkdtemp(join(tmpdir(), 'workspace-lifecycle-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

const gitApi = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  checkout: vi.fn(async () => undefined),
  raw: vi.fn(async (_args?: string[]) => ''),
  status: vi.fn(async () => ({ isClean: () => true, current: 'main' }))
}))

vi.mock('../git/client', () => ({
  gitFor: vi.fn(() => gitApi),
  clone: vi.fn(async ({ dest }: { url: string; dest: string }) => {
    await fs.mkdir(join(dest, '.git'), { recursive: true })
    await fs.writeFile(join(dest, 'README.md'), '# cloned\n')
  })
}))

const syncWorkspaceTemplatesMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./templates', () => ({
  syncWorkspaceTemplates: syncWorkspaceTemplatesMock
}))

const hydrateExternalManifestMock = vi.hoisted(() =>
  vi.fn(async () => ({ mounted: [], warnings: [] as string[] }))
)
vi.mock('../external-pool/service', () => ({
  hydrateExternalManifest: hydrateExternalManifestMock
}))

const watcherMocks = vi.hoisted(() => ({
  activate: vi.fn(async (): Promise<void> => undefined),
  stop: vi.fn(async (): Promise<void> => undefined),
  stopAll: vi.fn(async (): Promise<void> => undefined)
}))
vi.mock('../projects/watcher', () => ({
  projectWatcher: watcherMocks
}))

import { createWorkspace, cloneWorkspace, importWorkspace, removeWorkspace } from './lifecycle'
import { setWorkspaceWatchScope } from './service'
import { _testOnlyResetSharedCache, WorkspacesStore } from './store'
import { workspacesJsonPath } from './paths'

let parentDir: string

beforeEach(async () => {
  _testOnlyResetSharedCache()
  syncWorkspaceTemplatesMock.mockClear()
  hydrateExternalManifestMock.mockClear()
  hydrateExternalManifestMock.mockResolvedValue({ mounted: [], warnings: [] })
  Object.values(watcherMocks).forEach((mock) => mock.mockClear())
  gitApi.init.mockClear()
  gitApi.add.mockClear()
  gitApi.commit.mockClear()
  gitApi.checkout.mockClear()
  gitApi.raw.mockClear()
  gitApi.raw.mockResolvedValue('')
  gitApi.status.mockClear()
  gitApi.status.mockResolvedValue({ isClean: () => true, current: 'main' })
  await fs.rm(workspacesJsonPath(), { force: true })
  parentDir = await mkdtemp(join(tmpdir(), 'workspace-lifecycle-'))
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('workspace lifecycle template injection', () => {
  it('createWorkspace 默认在 .mywork 下创建 simple 项目且不初始化 Git', async () => {
    const ws = await createWorkspace({ parentDir, name: 'local-demo' })

    expect(ws.path).toBe(join(parentDir, '.mywork', 'local-demo'))
    expect(ws.kind).toBe('project')
    expect(ws.workflowMode).toBe('simple')
    expect(ws.managedPath).toBe(true)
    expect(gitApi.init).not.toHaveBeenCalled()
    expect(gitApi.add).not.toHaveBeenCalled()
    expect(gitApi.commit).not.toHaveBeenCalled()
    await expect(fs.stat(join(ws.path, '.git'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('importWorkspace 导入普通目录时不初始化 Git', async () => {
    const path = join(parentDir, 'plain-directory')
    await fs.mkdir(path, { recursive: true })

    const ws = await importWorkspace({ path })

    expect(ws.path).toBe(path)
    expect(ws.workflowMode).toBe('simple')
    expect(ws.managedPath).toBe(false)
    expect(gitApi.init).not.toHaveBeenCalled()
    expect(gitApi.add).not.toHaveBeenCalled()
    expect(gitApi.commit).not.toHaveBeenCalled()
  })

  it('cloneWorkspace 在 .mywork 下登记 simple 项目且不提交 scaffold', async () => {
    const ws = await cloneWorkspace({
      url: 'https://example.com/simple.git',
      parentDir,
      name: 'simple-clone',
    })

    expect(ws.path).toBe(join(parentDir, '.mywork', 'simple-clone'))
    expect(ws.workflowMode).toBe('simple')
    expect(ws.managedPath).toBe(true)
    expect(gitApi.add).not.toHaveBeenCalled()
    expect(gitApi.commit).not.toHaveBeenCalled()
  })

  it('createWorkspace 为 project 注入模板', async () => {
    const ws = await createWorkspace({ parentDir, name: 'demo' })

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(ws.path, 'project')
    expect(ws.kind).toBe('project')
  })

  it('createWorkspace 为 ux 注入 UX 模板', async () => {
    const ws = await createWorkspace({ parentDir, name: 'ux-demo', kind: 'ux' })

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(ws.path, 'ux')
    expect(ws.kind).toBe('ux')
  })

  it('createWorkspace 为 project 创建共享 docs 和 ui 目录', async () => {
    const ws = await createWorkspace({ parentDir, name: 'demo' })

    await expect(fs.stat(join(ws.path, 'docs', '.gitkeep'))).resolves.toBeTruthy()
    await expect(fs.stat(join(ws.path, 'ui', '.gitkeep'))).resolves.toBeTruthy()
  })

  it('createWorkspace 为 asset 不注入模板', async () => {
    await createWorkspace({ parentDir, name: 'asset-lib', kind: 'asset' })

    expect(syncWorkspaceTemplatesMock).not.toHaveBeenCalled()
  })

  it('importWorkspace 为 ux 注入模板', async () => {
    const path = join(parentDir, 'ux-existing')
    await fs.mkdir(path, { recursive: true })

    const ws = await importWorkspace({ path, kind: 'ux' })

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(path, 'ux')
    expect(ws.kind).toBe('ux')
  })

  it('importWorkspace 为 project 注入模板', async () => {
    const path = join(parentDir, 'existing')
    await fs.mkdir(path, { recursive: true })

    await importWorkspace({ path })

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(path, 'project')
  })

  it('cloneWorkspace 为 project 注入模板', async () => {
    const ws = await cloneWorkspace({
      url: 'https://example.com/demo.git',
      parentDir,
      name: 'cloned'
    })

    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(ws.path, 'project')
  })

  it('cloneWorkspace 克隆后初始化失败会清理目标目录', async () => {
    syncWorkspaceTemplatesMock.mockRejectedValueOnce(new Error('skill templates directory not found'))
    const dest = join(parentDir, 'broken-clone')

    await expect(cloneWorkspace({
      url: 'https://example.com/demo.git',
      parentDir,
      name: 'broken-clone'
    })).rejects.toMatchObject({
      code: 'WORKSPACE_INIT_FAILED',
      message: '项目初始化失败：skill templates directory not found'
    })

    await expect(fs.stat(dest)).rejects.toBeTruthy()
    const workspaces = await new WorkspacesStore().list()
    expect(workspaces.map((item) => item.path)).not.toContain(dest)
  })

  it('cloneWorkspace 克隆后如果落在无效 master，会切到远端 main 再初始化外联', async () => {
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'master' })
    gitApi.raw.mockImplementation(async (args?: string[]) => {
      if (!args) return ''
      if (args[0] === 'symbolic-ref') throw new Error('origin HEAD missing')
      if (args[0] === 'branch' && args[1] === '-r') return 'origin/main\norigin/req/demo\n'
      return ''
    })

    const ws = await cloneWorkspace({
      url: 'https://example.com/demo.git',
      parentDir,
      name: 'cloned-main'
    })

    expect(gitApi.checkout).toHaveBeenCalledWith(['-B', 'main', 'origin/main'])
    expect(gitApi.raw).toHaveBeenCalledWith(['branch', '--set-upstream-to=origin/main', 'main'])
    expect(hydrateExternalManifestMock).toHaveBeenCalledWith(ws.id)
    expect(ws.defaultBranch).toBe('main')
  })

  it('cloneWorkspace 为 ux 项目也会对齐远端默认分支，但不初始化外联', async () => {
    gitApi.status.mockResolvedValue({ isClean: () => true, current: 'master' })
    gitApi.raw.mockImplementation(async (args?: string[]) => {
      if (!args) return ''
      if (args[0] === 'symbolic-ref') throw new Error('origin HEAD missing')
      if (args[0] === 'branch' && args[1] === '-r') return 'origin/main\norigin/ux/demo\n'
      return ''
    })

    const ws = await cloneWorkspace({
      url: 'https://example.com/ux.git',
      parentDir,
      name: 'ux-cloned',
      kind: 'ux'
    })

    expect(gitApi.checkout).toHaveBeenCalledWith(['-B', 'main', 'origin/main'])
    expect(syncWorkspaceTemplatesMock).toHaveBeenCalledWith(ws.path, 'ux')
    expect(hydrateExternalManifestMock).not.toHaveBeenCalled()
    expect(ws.kind).toBe('ux')
    expect(ws.defaultBranch).toBe('main')
  })

  it('cloneWorkspace 识别外部依赖失败时把 warning 返回给前端提醒', async () => {
    hydrateExternalManifestMock.mockResolvedValueOnce({
      mounted: [],
      warnings: ['外部依赖 POS知识库 初始化失败：git pull 失败：auth failed']
    })

    const ws = await cloneWorkspace({
      url: 'https://example.com/demo.git',
      parentDir,
      name: 'cloned'
    })

    expect(hydrateExternalManifestMock).toHaveBeenCalledWith(ws.id)
    expect(ws.externalInitWarnings).toEqual([
      '外部依赖 POS知识库 初始化失败：git pull 失败：auth failed'
    ])
  })

  it('importWorkspace 识别外部依赖抛错时把 warning 返回给前端提醒', async () => {
    const path = join(parentDir, 'existing-with-config')
    await fs.mkdir(path, { recursive: true })
    hydrateExternalManifestMock.mockRejectedValueOnce(new Error('manifest clone failed'))

    const ws = await importWorkspace({ path })

    expect(ws.externalInitWarnings).toEqual([
      '外部依赖初始化失败：manifest clone failed'
    ])
  })

  it('本地新建项目不主动生成 gitignore', async () => {
    const ws = await createWorkspace({ parentDir, name: 'demo' })

    await expect(fs.stat(join(ws.path, '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('从 Git 克隆时 gitignore 忽略应用内部目录', async () => {
    const ws = await cloneWorkspace({
      url: 'https://example.com/demo.git',
      parentDir,
      name: 'gitignore-clone',
    })

    const gitignore = await fs.readFile(join(ws.path, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.ui-client/')
    expect(gitignore).toContain('.external/')
    expect(gitignore).toContain('.workspace/project-context.json')
    expect(gitignore).toContain('.workspace/session-id')
    expect(gitignore).toContain('.workspace/home-session-id')
    expect(gitignore).toContain('.workspace/document-sessions/')
    expect(gitignore).toContain('.claude/skills/')
    expect(gitignore).toContain('.agents/skills/')
    expect(gitignore).toContain('.cursor/rules/ui-client-ui-assets.mdc')
  })

  it('removeWorkspace 仅在明确要求时删除 App 托管目录', async () => {
    const ws = await createWorkspace({ parentDir, name: 'demo' })
    await fs.writeFile(join(ws.path, 'local.txt'), 'local data', 'utf-8')

    await removeWorkspace(ws.id, { deleteFiles: true })

    await expect(fs.stat(ws.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new WorkspacesStore().findById(ws.id)).resolves.toBeNull()
    expect(gitApi.status).not.toHaveBeenCalled()
  })

  it('removeWorkspace 默认只移除索引并保留导入目录', async () => {
    const path = join(parentDir, 'imported-project')
    await fs.mkdir(path, { recursive: true })
    await fs.writeFile(join(path, 'user-data.txt'), 'keep me', 'utf-8')
    const ws = await importWorkspace({ path })

    await removeWorkspace(ws.id)

    await expect(fs.readFile(join(path, 'user-data.txt'), 'utf-8')).resolves.toBe('keep me')
    await expect(new WorkspacesStore().findById(ws.id)).resolves.toBeNull()
  })

  it('removeWorkspace 即使请求删除也不会删除非托管目录', async () => {
    const path = join(parentDir, 'external-project')
    await fs.mkdir(path, { recursive: true })
    const ws = await importWorkspace({ path })

    await removeWorkspace(ws.id, { deleteFiles: true })

    await expect(fs.stat(path)).resolves.toBeTruthy()
  })

  it('删除期间排队的 scope 请求不会在 workspace 删除后启动监听', async () => {
    const ws = await createWorkspace({ parentDir, name: 'remove-scope-race' })
    const stopGate = deferred()
    watcherMocks.stop.mockReturnValueOnce(stopGate.promise)

    const removePromise = removeWorkspace(ws.id)
    await vi.waitFor(() => expect(watcherMocks.stop).toHaveBeenCalledWith(ws.id))
    const scopePromise = setWorkspaceWatchScope(ws.id, 'outputs/stale')
    const scopeRejected = expect(scopePromise).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await Promise.resolve()

    expect(watcherMocks.activate).not.toHaveBeenCalled()
    stopGate.resolve()
    await Promise.all([removePromise, scopeRejected])

    expect(watcherMocks.activate).not.toHaveBeenCalled()
    await expect(new WorkspacesStore().findById(ws.id)).resolves.toBeNull()
  })

  it('创建切换 active workspace 期间排队的旧 scope 不会启动监听', async () => {
    const oldWorkspace = await createWorkspace({ parentDir, name: 'active-old' })
    watcherMocks.stopAll.mockClear()
    const stopGate = deferred()
    watcherMocks.stopAll.mockReturnValueOnce(stopGate.promise)

    const createPromise = createWorkspace({ parentDir, name: 'active-next' })
    await vi.waitFor(() => expect(watcherMocks.stopAll).toHaveBeenCalledOnce())
    const staleScopePromise = setWorkspaceWatchScope(oldWorkspace.id, 'outputs/stale')
    const staleScopeRejected = expect(staleScopePromise)
      .rejects.toMatchObject({ code: 'VALIDATION' })
    await Promise.resolve()

    expect(watcherMocks.activate).not.toHaveBeenCalled()
    stopGate.resolve()
    const [nextWorkspace] = await Promise.all([createPromise, staleScopeRejected])

    expect(watcherMocks.activate).not.toHaveBeenCalled()
    await expect(new WorkspacesStore().activeId()).resolves.toBe(nextWorkspace.id)
  })
})
