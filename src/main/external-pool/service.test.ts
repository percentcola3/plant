import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, mkdtempSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

type GitStatusMock = { isClean: () => boolean; files: Array<{ path: string }> }
const gitApi = vi.hoisted(() => ({
  branch: vi.fn(async () => ({ current: 'master' })),
  checkout: vi.fn(async () => undefined),
  fetch: vi.fn(async () => undefined),
  raw: vi.fn(async (_args?: string[]) => 'refs/remotes/origin/main\n'),
  pull: vi.fn(async () => undefined),
  status: vi.fn(async (): Promise<GitStatusMock> => ({ isClean: () => true, files: [] }))
}))
const gitConfigApi = vi.hoisted(() => ({
  raw: vi.fn(async (_args?: string[]) => '')
}))
const cloneMock = vi.hoisted(() => vi.fn(async ({ dest }: { url: string; dest: string }) => {
  await fs.mkdir(dest, { recursive: true })
  await fs.writeFile(join(dest, 'README.md'), '# fake clone\n')
}))
const scheduleResourceIndexBuildMock = vi.hoisted(() => vi.fn())
vi.mock('../resource-index/service', () => ({
  scheduleResourceIndexBuild: scheduleResourceIndexBuildMock,
  readResourceIndexStatus: vi.fn(async (id: string) => ({
    externalRefId: id,
    state: 'missing',
    updatedAt: '2026-07-21T00:00:00.000Z'
  })),
  readResourceIndexStatusLive: vi.fn(async (id: string) => ({
    externalRefId: id,
    state: 'missing',
    updatedAt: '2026-07-21T00:00:00.000Z'
  }))
}))

// 拦截真实 git clone：用 mkdir 模拟
vi.mock('../git/client', () => ({
  clone: cloneMock,
  gitFor: vi.fn(() => gitConfigApi),
  gitForWithAskpass: vi.fn(async () => gitApi),
  gitForBackground: vi.fn(() => gitApi)
}))

import type { Workspace } from '@shared/types'
import { _testOnlyResetSharedCache as resetPool } from './store'
import { _testOnlyResetSharedCache as resetWs, WorkspacesStore } from '../workspaces/store'
import { indexFile, poolEntryPath, poolRoot } from './paths'
import { workspacesJsonPath, externalDir, refsPath, REFS_FILENAME } from '../workspaces/paths'
import {
  addExternalRef,
  attachExternalRef,
  detachExternalRef,
  hydrateExternalManifest,
  listExternalRefs,
  listExternalRefBranches,
  readExternalRefSyncStatus,
  refreshExternalRef,
  refreshAllExternalRefs,
  EXTERNAL_AUTO_REFRESH_INTERVAL_MS,
  readFeatureExternalRefs,
  requestExternalRefIndexBuild,
  removeExternalRef,
  startAutoRefresh,
  stopAutoRefresh,
  switchExternalRefCheckout,
  updateFeatureExternalRefs,
  updateExternalRefBinding
} from './service'
import { readRefs } from '../workspaces/refs'
import { readExternalManifest, writeExternalManifest } from '../workspaces/external-manifest'
import { UIClientError } from '../ipc/errors'
import { prepareZgIndexWorkspace } from '../zg/zg-search'

let wsDir: string
let wsStore: WorkspacesStore

const projectWorkspace = (path: string): Workspace => ({
  id: 'ws-1',
  kind: 'project',
  name: 'demo',
  path,
  defaultBranch: 'main',
  addedAt: '2026-06-09T00:00:00.000Z',
  lastActiveAt: '2026-06-09T00:00:00.000Z'
})

async function unlockRecursive(path: string): Promise<void> {
  const stat = await fs.lstat(path).catch(() => null)
  if (!stat) return
  if (stat.isSymbolicLink()) return
  await fs.chmod(path, stat.isDirectory() ? 0o755 : 0o644).catch(() => undefined)
  if (!stat.isDirectory()) return
  const entries = await fs.readdir(path).catch(() => [])
  for (const entry of entries) {
    await unlockRecursive(join(path, entry))
  }
}

beforeEach(async () => {
  electronPaths.userData = await mkdtemp(join(tmpdir(), 'external-pool-svc-test-'))
  resetPool()
  resetWs()
  await unlockRecursive(poolRoot())
  await fs.rm(indexFile(), { force: true })
  await fs.rm(workspacesJsonPath(), { force: true })
  await fs.rm(poolRoot(), { recursive: true, force: true })
  resetPool()
  resetWs()
  gitApi.checkout.mockReset()
  gitApi.checkout.mockResolvedValue(undefined)
  gitApi.branch.mockReset()
  gitApi.branch.mockResolvedValue({ current: 'master' })
  gitApi.fetch.mockReset()
  gitApi.fetch.mockResolvedValue(undefined)
  gitApi.raw.mockReset()
  gitApi.raw.mockResolvedValue('refs/remotes/origin/main\n')
  gitApi.pull.mockReset()
  gitApi.pull.mockResolvedValue(undefined)
  gitApi.status.mockReset()
  gitApi.status.mockResolvedValue({ isClean: () => true, files: [] })
  gitConfigApi.raw.mockReset()
  gitConfigApi.raw.mockResolvedValue('')
  cloneMock.mockReset()
  cloneMock.mockImplementation(async ({ dest }: { url: string; dest: string }) => {
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(join(dest, 'README.md'), '# fake clone\n')
  })
  scheduleResourceIndexBuildMock.mockClear()
  stopAutoRefresh()
  wsDir = await mkdtemp(join(tmpdir(), 'ws-host-'))
  wsStore = new WorkspacesStore()
  await wsStore.remove('ws-1').catch(() => undefined)
  await wsStore.add(projectWorkspace(wsDir))
})

afterEach(async () => {
  stopAutoRefresh()
  vi.useRealTimers()
  await fs.rm(wsDir, { recursive: true, force: true })
  await unlockRecursive(electronPaths.userData)
  await fs.rm(electronPaths.userData, { recursive: true, force: true })
})

describe('addExternalRef - local', () => {
  it('正常添加本地目录 → poolPath = source', async () => {
    const src = mkdtempSync(join(tmpdir(), 'local-src-'))
    const ref = await addExternalRef({
      alias: 'local-lib', category: 'uikit', kind: 'local', sourcePath: src
    })
    expect(ref.kind).toBe('local')
    expect(ref.poolPath).toBe(src)
    expect(await listExternalRefs()).toHaveLength(1)
    expect(scheduleResourceIndexBuildMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: ref.id }),
      'first-import'
    )
  })

  it('非绝对路径抛 VALIDATION', async () => {
    await expect(addExternalRef({
      alias: 'x', category: 'uikit', kind: 'local', sourcePath: 'relative/path'
    })).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('目录不存在抛 NOT_FOUND', async () => {
    await expect(addExternalRef({
      alias: 'x', category: 'uikit', kind: 'local', sourcePath: '/no-such-place-12345'
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('addExternalRef - git (mocked clone)', () => {
  it('clone 成功 → 池里出现 entry', async () => {
    const ref = await addExternalRef({
      alias: 'remote-lib', category: 'uikit', kind: 'git', url: 'https://example.com/x.git'
    })
    expect(ref.kind).toBe('git')
    expect(ref.poolPath).toBe(poolEntryPath(ref.id))
    const stat = await fs.stat(ref.poolPath)
    expect(stat.isDirectory()).toBe(true)
    expect(scheduleResourceIndexBuildMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: ref.id }),
      'first-import'
    )
  })

  it('git 池只读锁不锁死 zg 索引目录', async () => {
    const ref = await addExternalRef({
      alias: 'kb-index', category: 'knowledge', kind: 'git', url: 'https://example.com/kb.git'
    })
    const readmeMode = (await fs.stat(join(ref.poolPath, 'README.md'))).mode & 0o777
    expect(readmeMode).toBe(0o444)

    await expect(fs.mkdir(join(ref.poolPath, '.zvec-grep'))).rejects.toMatchObject({ code: 'EACCES' })

    prepareZgIndexWorkspace(ref.poolPath)
    const lockDir = join(ref.poolPath, '.zvec-grep', 'locks', 'home.readers', 'probe')
    await fs.mkdir(lockDir, { recursive: true })
    await fs.writeFile(join(lockDir, 'lease'), 'ok')

    await readExternalRefSyncStatus(ref.id)
    const afterStatus = join(ref.poolPath, '.zvec-grep', 'locks', 'home.readers', 'after-status')
    await fs.mkdir(afterStatus)
    expect((await fs.stat(join(ref.poolPath, 'README.md'))).mode & 0o777).toBe(0o444)
  })

  it('非法 url 抛 VALIDATION', async () => {
    await expect(addExternalRef({
      alias: 'x', category: 'uikit', kind: 'git', url: 'not-a-url'
    })).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('preserves SSH setup errors from the shared clone path', async () => {
    const countBefore = (await listExternalRefs()).length
    cloneMock.mockRejectedValueOnce(new UIClientError('SSH_KEY_REQUIRED', '请先配置 SSH Key'))

    await expect(addExternalRef({
      alias: 'ssh-lib', category: 'knowledge', kind: 'git', url: 'git@git.example.com:team/kb.git'
    })).rejects.toMatchObject({ code: 'SSH_KEY_REQUIRED' })
    await expect(listExternalRefs()).resolves.toHaveLength(countBefore)
  })

  it('clone 时指定 checkout 会切换并记录到池条目', async () => {
    const ref = await addExternalRef({
      alias: 'remote-branch-lib',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/kb.git',
      checkout: { type: 'branch', value: 'release/docs' }
    })

    expect(gitApi.checkout).toHaveBeenCalledWith('release/docs')
    expect(ref.checkout).toEqual({ type: 'branch', value: 'release/docs' })
    expect(await listExternalRefs()).toContainEqual(expect.objectContaining({
      id: ref.id,
      checkout: { type: 'branch', value: 'release/docs' }
    }))
  })
})

describe('attachExternalRef / detachExternalRef', () => {
  let aliasSeq = 0

  async function addLocal(alias?: string): Promise<string> {
    const safeAlias = alias ?? `lib-${++aliasSeq}`
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    await fs.writeFile(join(src, 'palette.css'), '/* test */')
    const ref = await addExternalRef({
      alias: safeAlias, category: 'uikit', kind: 'local', sourcePath: src
    })
    return ref.id
  }

  it('成功挂载 → 软链 + refs.json + .gitignore', async () => {
    await fs.mkdir(join(wsDir, '.git'))
    const id = await addLocal('lib1')
    await attachExternalRef('ws-1', id)

    const linkStat = await fs.lstat(join(externalDir(wsDir), 'lib1'))
    expect(linkStat.isSymbolicLink()).toBe(true)

    const bindings = await readRefs(wsDir)
    expect(bindings).toHaveLength(1)
    expect(bindings[0].externalRefId).toBe(id)

    const gitignore = await fs.readFile(join(wsDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.external/')

    const context = JSON.parse(await fs.readFile(join(wsDir, '.workspace/project-context.json'), 'utf-8')) as {
      uiAssets: Array<{ alias: string; path: string }>
    }
    expect(context.uiAssets).toEqual([
      expect.objectContaining({ alias: 'lib1', path: '.external/lib1' })
    ])
  })

  it('项目可以同时关联多个 UX 资产，并独立保存所选资源', async () => {
    const firstId = await addLocal('ux-components')
    const secondId = await addLocal('ux-tokens')
    await fs.mkdir(join(wsDir, 'features/order-page'), { recursive: true })
    await fs.writeFile(join(wsDir, 'features/order-page/index.html'), '<main>order</main>')

    const selected = await updateFeatureExternalRefs('ws-1', 'features/order-page', [firstId, secondId])
    expect(selected.externalRefIds).toEqual([firstId, secondId])
    expect((await readRefs(wsDir)).map((binding) => binding.externalRefId)).toEqual([firstId, secondId])

    const loaded = await readFeatureExternalRefs('ws-1', 'features/order-page')
    expect(loaded).toMatchObject({ configured: true, externalRefIds: [firstId, secondId] })

    await updateFeatureExternalRefs('ws-1', 'features/order-page', [secondId])
    await expect(readFeatureExternalRefs('ws-1', 'features/order-page')).resolves.toMatchObject({
      configured: true,
      externalRefIds: [secondId]
    })
  })

  it('旧项目没有独立配置时继承根项目已挂载资源', async () => {
    const id = await addLocal('legacy-assets')
    await attachExternalRef('ws-1', id)
    await fs.mkdir(join(wsDir, 'features/legacy'), { recursive: true })

    await expect(readFeatureExternalRefs('ws-1', 'features/legacy')).resolves.toMatchObject({
      configured: false,
      externalRefIds: [id]
    })
  })

  it('非 Git 项目挂载资源包时不创建 .gitignore', async () => {
    const id = await addLocal('local-only')
    await attachExternalRef('ws-1', id)
    await expect(fs.stat(join(wsDir, '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('挂载资源包会把说明文件和项目说明写入项目上下文', async () => {
    const src = mkdtempSync(join(tmpdir(), 'resource-package-'))
    await fs.writeFile(join(src, 'AI_USAGE.md'), '# 使用方式\n优先复用现有组件。\n')
    const ref = await addExternalRef({
      alias: 'design-guide', category: 'uikit', kind: 'local', sourcePath: src
    })

    await attachExternalRef('ws-1', ref.id, { usageNote: '本项目只使用移动端组件。' })

    const context = JSON.parse(await fs.readFile(join(wsDir, '.workspace/project-context.json'), 'utf-8')) as {
      externalRefs: Array<{ category?: string; instructionPath?: string; usageNote?: string }>
    }
    expect(context.externalRefs[0]).toEqual(expect.objectContaining({
      category: 'uikit',
      instructionPath: '.external/design-guide/AI_USAGE.md',
      usageNote: '本项目只使用移动端组件。'
    }))
  })

  it('挂载 git 外部库会写入共享 manifest', async () => {
    const ref = await addExternalRef({
      alias: 'remote-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/kb.git',
      checkout: { type: 'branch', value: 'docs-main' }
    })
    await attachExternalRef('ws-1', ref.id)

    const manifest = await readExternalManifest(wsDir)
    expect(manifest.refs).toEqual([
      expect.objectContaining({
        alias: 'remote-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/kb.git',
        checkout: { type: 'branch', value: 'docs-main' },
        readonly: true
      })
    ])
  })

  it('updateExternalRefBinding 保存知识库目录筛选并同步项目上下文', async () => {
    const ref = await addExternalRef({
      alias: 'filtered-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/filtered-kb.git'
    })
    await attachExternalRef('ws-1', ref.id)

    const updated = await updateExternalRefBinding('ws-1', ref.id, {
      visibleDirs: ['docs/api', 'docs', 'research/payment']
    })

    expect(updated.visibleDirs).toEqual(['docs', 'research/payment'])
    expect(await readRefs(wsDir)).toEqual([
      expect.objectContaining({
        alias: 'filtered-kb',
        externalRefId: ref.id,
        visibleDirs: ['docs', 'research/payment']
      })
    ])
    const context = JSON.parse(await fs.readFile(join(wsDir, '.workspace/project-context.json'), 'utf-8')) as {
      kbRefs: Array<{ visibleDirs?: string[]; paths?: string[] }>
    }
    expect(context.kbRefs[0].visibleDirs).toEqual(['docs', 'research/payment'])
    expect(context.kbRefs[0].paths).toEqual([
      '.external/filtered-kb/docs',
      '.external/filtered-kb/research/payment'
    ])

    const manifest = await readExternalManifest(wsDir)
    expect(manifest.refs).toEqual([
      expect.objectContaining({
        alias: 'filtered-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/filtered-kb.git',
        visibleDirs: ['docs', 'research/payment']
      })
    ])
  })

  it('detach git 外部库会从共享 manifest 移除', async () => {
    const ref = await addExternalRef({
      alias: 'remote-ui',
      category: 'uikit',
      kind: 'git',
      url: 'https://example.com/ui.git'
    })
    await attachExternalRef('ws-1', ref.id)
    await detachExternalRef('ws-1', ref.id)

    const manifest = await readExternalManifest(wsDir)
    expect(manifest.refs).toEqual([])
  })

  it('hydrate manifest 会自动 clone 到池并挂载软链', async () => {
    await writeExternalManifest(wsDir, {
      schemaVersion: 1,
      refs: [{
        alias: 'shared-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/shared-kb.git',
        readonly: true
      }]
    })

    const result = await hydrateExternalManifest('ws-1')

    expect(result.warnings).toEqual([])
    expect(result.mounted).toEqual(['shared-kb'])
    expect(await readRefs(wsDir)).toEqual([
      expect.objectContaining({ alias: 'shared-kb' })
    ])
    const linkStat = await fs.lstat(join(externalDir(wsDir), 'shared-kb'))
    expect(linkStat.isSymbolicLink()).toBe(true)
    expect(await listExternalRefs()).toContainEqual(expect.objectContaining({
      alias: 'shared-kb',
      kind: 'git',
      source: 'https://example.com/shared-kb.git'
    }))
  })

  it('hydrate manifest 会把知识库目录筛选回填到本机绑定', async () => {
    await writeExternalManifest(wsDir, {
      schemaVersion: 1,
      refs: [{
        alias: 'shared-filtered-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/shared-filtered-kb.git',
        visibleDirs: ['docs/api', 'docs', 'research/payment'],
        readonly: true
      }]
    })

    const result = await hydrateExternalManifest('ws-1')

    expect(result.warnings).toEqual([])
    expect(result.mounted).toEqual(['shared-filtered-kb'])
    expect(await readRefs(wsDir)).toEqual([
      expect.objectContaining({
        alias: 'shared-filtered-kb',
        visibleDirs: ['docs', 'research/payment']
      })
    ])
    const context = JSON.parse(await fs.readFile(join(wsDir, '.workspace/project-context.json'), 'utf-8')) as {
      kbRefs: Array<{ visibleDirs?: string[]; paths?: string[] }>
    }
    expect(context.kbRefs[0].visibleDirs).toEqual(['docs', 'research/payment'])
    expect(context.kbRefs[0].paths).toEqual([
      '.external/shared-filtered-kb/docs',
      '.external/shared-filtered-kb/research/payment'
    ])
  })

  it('hydrate manifest 会清掉本机旧的知识库目录筛选', async () => {
    const ref = await addExternalRef({
      alias: 'shared-all-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/shared-all-kb.git'
    })
    await attachExternalRef('ws-1', ref.id)
    await updateExternalRefBinding('ws-1', ref.id, {
      visibleDirs: ['docs']
    })
    await writeExternalManifest(wsDir, {
      schemaVersion: 1,
      refs: [{
        alias: 'shared-all-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/shared-all-kb.git',
        readonly: true
      }]
    })

    const result = await hydrateExternalManifest('ws-1')

    expect(result.warnings).toEqual([])
    expect(result.mounted).toEqual(['shared-all-kb'])
    expect(await readRefs(wsDir)).toEqual([
      expect.not.objectContaining({ visibleDirs: expect.any(Array) })
    ])
    const context = JSON.parse(await fs.readFile(join(wsDir, '.workspace/project-context.json'), 'utf-8')) as {
      kbRefs: Array<{ paths?: string[] }>
    }
    expect(context.kbRefs[0].paths).toEqual(['.external/shared-all-kb'])
  })

  it('hydrate manifest 命中已存在 git 外部库时会先同步', async () => {
    const ref = await addExternalRef({
      alias: 'existing-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/existing-kb.git'
    })
    gitApi.pull.mockClear()
    await writeExternalManifest(wsDir, {
      schemaVersion: 1,
      refs: [{
        alias: 'existing-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/existing-kb.git',
        readonly: true
      }]
    })

    const result = await hydrateExternalManifest('ws-1')

    expect(result.warnings).toEqual([])
    expect(result.mounted).toEqual(['existing-kb'])
    expect(gitApi.pull).toHaveBeenCalledTimes(1)
    const refs = await listExternalRefs()
    expect(refs.find((item) => item.id === ref.id)?.lastSyncedAt).toBeTruthy()
  })

  it('hydrate manifest 拉取失败时不阻断 attach（外挂标 stale，主流程继续）', async () => {
    // refresh 失败（缺凭证 / 网络问题）属于"外挂同步失败"，不应阻塞用户进入项目。
    // 之前一次成功的内容仍在池里，attach 后用户依然能用。
    await addExternalRef({
      alias: 'stale-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/stale-kb.git'
    })
    gitApi.pull.mockRejectedValueOnce(new Error('auth failed'))
    await writeExternalManifest(wsDir, {
      schemaVersion: 1,
      refs: [{
        alias: 'stale-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/stale-kb.git',
        readonly: true
      }]
    })

    const result = await hydrateExternalManifest('ws-1')

    expect(result.mounted).toEqual(['stale-kb'])
    expect(result.warnings).toEqual([])
  })

  it('幂等：同对重复 attach 不报错也不重复', async () => {
    const id = await addLocal()
    await attachExternalRef('ws-1', id)
    await attachExternalRef('ws-1', id)
    const bindings = await readRefs(wsDir)
    expect(bindings).toHaveLength(1)
  })

  it('alias 冲突：不同 id 同 alias 抛 ALIAS_CONFLICT', async () => {
    const id1 = await addLocal('shared')
    // 先正常挂第一条
    await attachExternalRef('ws-1', id1)
    // 把项目内现有软链替换成"假冒"目标，让幂等检查走不通；最简单：手工 ln 一个跟池路径不同的目标
    // 这里用更直接的反例：再添加一条同 alias 的池条目其实在 store 层就被拦了
    // 所以构造另一条不同 alias 的库，然后手工把它挂成同名
    const id2 = await addLocal('other-lib')
    // 手工把"other-lib"以 "shared" 名字挂上
    await fs.unlink(join(externalDir(wsDir), 'shared'))
    await fs.symlink('/some/other/path', join(externalDir(wsDir), 'shared'))
    // 现在原条目 shared 想再次 attach 触发冲突
    await expect(attachExternalRef('ws-1', id1)).rejects.toMatchObject({ code: 'ALIAS_CONFLICT' })
    void id2
  })

  it('detach 删软链 + refs.json 移除', async () => {
    const alias = 'detach-lib'
    const id = await addLocal(alias)
    await attachExternalRef('ws-1', id)
    await detachExternalRef('ws-1', id)
    const linkExists = await fs.lstat(join(externalDir(wsDir), alias)).then(() => true).catch(() => false)
    expect(linkExists).toBe(false)
    expect(await readRefs(wsDir)).toEqual([])

    const context = JSON.parse(await fs.readFile(join(wsDir, '.workspace/project-context.json'), 'utf-8')) as {
      uiAssets: Array<{ alias: string }>
    }
    expect(context.uiAssets).toEqual([])
  })

  it('detach 不存在的 binding 静默', async () => {
    await expect(detachExternalRef('ws-1', 'never-attached')).resolves.toBeUndefined()
  })

  it('attach 到非 project workspace 抛 VALIDATION', async () => {
    // 切换 ws-1 为 asset
    await wsStore.updateWorkspace('ws-1', { kind: 'asset' })
    const id = await addLocal()
    await expect(attachExternalRef('ws-1', id)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('attach workspaceId 不存在抛 NOT_FOUND', async () => {
    const id = await addLocal()
    await expect(attachExternalRef('ws-missing', id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('attach externalRefId 不存在抛 NOT_FOUND', async () => {
    await expect(attachExternalRef('ws-1', 'r-missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('removeExternalRef 级联清理', () => {
  it('引用此 id 的工作区会被 detach', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const ref = await addExternalRef({
      alias: 'cascade', category: 'uikit', kind: 'local', sourcePath: src
    })
    await attachExternalRef('ws-1', ref.id)
    expect(await readRefs(wsDir)).toHaveLength(1)

    await removeExternalRef(ref.id)
    expect(await readRefs(wsDir)).toEqual([])
    expect(await fs.lstat(join(externalDir(wsDir), 'cascade')).then(() => true).catch(() => false))
      .toBe(false)
  })
})

describe('refreshExternalRef', () => {
  let refreshAliasSeq = 0

  it('local 类型 source 仍存在 → ok', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const ref = await addExternalRef({
      alias: `r-${++refreshAliasSeq}`, category: 'uikit', kind: 'local', sourcePath: src
    })
    expect((await refreshExternalRef(ref.id)).ok).toBe(true)
  })

  it('local 类型 source 丢失 → ok=false', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const ref = await addExternalRef({
      alias: `r-${++refreshAliasSeq}`, category: 'uikit', kind: 'local', sourcePath: src
    })
    await fs.rm(src, { recursive: true })
    const res = await refreshExternalRef(ref.id)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('SOURCE_GONE')
  })

  it('未知 id → ok=false NOT_FOUND', async () => {
    expect(await refreshExternalRef('missing')).toEqual({ ok: false, message: 'NOT_FOUND' })
  })

  it('git upstream 指向不存在的 master 时，改用远端默认分支同步', async () => {
    const ref = await addExternalRef({
      alias: `r-${++refreshAliasSeq}`, category: 'uikit', kind: 'git', url: 'https://example.com/ui.git'
    })
    gitApi.pull.mockClear()
    gitApi.pull
      .mockRejectedValueOnce(new Error("Your configuration specifies to merge with the ref 'refs/heads/master' from the remote, but no such ref was fetched."))
      .mockResolvedValueOnce(undefined)

    const res = await refreshExternalRef(ref.id)

    expect(res.ok).toBe(true)
    expect(gitApi.raw).toHaveBeenCalledWith(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    expect(gitApi.checkout).toHaveBeenCalledWith(['-B', 'main', 'origin/main'])
    expect(gitApi.raw).toHaveBeenCalledWith(['branch', '--set-upstream-to=origin/main', 'main'])
    expect(gitApi.pull).toHaveBeenCalledTimes(2)
  })

  it('手动更新遇到真实本地变更时跳过并提示，不执行 pull', async () => {
    const ref = await addExternalRef({
      alias: `r-${++refreshAliasSeq}`, category: 'knowledge', kind: 'git', url: 'https://example.com/dirty.git'
    })
    gitApi.pull.mockClear()
    gitApi.status.mockResolvedValueOnce({ isClean: () => false, files: [{ path: 'README.md' }] })

    const res = await refreshExternalRef(ref.id, { interactive: true })

    expect(res.ok).toBe(false)
    expect(res.message).toContain('LOCAL_CHANGES')
    expect(res.message).toContain('索引文件存放在 App 数据目录')
    expect(gitApi.pull).not.toHaveBeenCalled()
  })

  it('后台自动更新遇到本地变更时静默跳过', async () => {
    const ref = await addExternalRef({
      alias: `r-${++refreshAliasSeq}`, category: 'knowledge', kind: 'git', url: 'https://example.com/dirty-bg.git'
    })
    gitApi.pull.mockClear()
    gitApi.status.mockResolvedValueOnce({ isClean: () => false, files: [{ path: 'README.md' }] })

    await expect(refreshExternalRef(ref.id, { interactive: false })).resolves.toEqual({ ok: true })
    expect(gitApi.pull).not.toHaveBeenCalled()
  })
})

describe('switchExternalRefCheckout', () => {
  it('切换 git 外部库 checkout 后更新池条目和已绑定项目 manifest', async () => {
    const ref = await addExternalRef({
      alias: 'switchable-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/switchable-kb.git'
    })
    await attachExternalRef('ws-1', ref.id)
    await updateExternalRefBinding('ws-1', ref.id, {
      visibleDirs: ['docs/api', 'docs', 'research/payment']
    })
    gitApi.fetch.mockClear()
    gitApi.checkout.mockClear()

    const updated = await switchExternalRefCheckout(ref.id, { type: 'branch', value: 'next-docs' })

    expect(updated.checkout).toEqual({ type: 'branch', value: 'next-docs' })
    expect(gitApi.fetch).not.toHaveBeenCalled()
    expect(gitApi.checkout).toHaveBeenCalledWith('next-docs')
    expect(await listExternalRefs()).toContainEqual(expect.objectContaining({
      id: ref.id,
      checkout: { type: 'branch', value: 'next-docs' }
    }))
    const manifest = await readExternalManifest(wsDir)
    expect(manifest.refs).toEqual([
      expect.objectContaining({
        alias: 'switchable-kb',
        checkout: { type: 'branch', value: 'next-docs' },
        visibleDirs: ['docs', 'research/payment']
      })
    ])
  })

  it('local 外部库不允许切换 checkout', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const ref = await addExternalRef({
      alias: 'local-no-checkout',
      category: 'knowledge',
      kind: 'local',
      sourcePath: src
    })

    await expect(switchExternalRefCheckout(ref.id, { type: 'branch', value: 'main' }))
      .rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('listExternalRefBranches', () => {
  it('不 fetch，直接列出 git 外部库已有的远端分支并去重', async () => {
    const ref = await addExternalRef({
      alias: 'branch-list-kb',
      category: 'knowledge',
      kind: 'git',
      url: 'https://example.com/branch-list-kb.git'
    })
    gitApi.fetch.mockClear()
    gitApi.fetch.mockRejectedValueOnce(new Error("error: cannot open '.git/FETCH_HEAD': Permission denied"))
    gitApi.raw.mockResolvedValueOnce([
      'origin/HEAD -> origin/main',
      'origin/main',
      'origin/release/docs',
      'upstream/release/docs',
      ''
    ].join('\n'))

    const result = await listExternalRefBranches(ref.id)

    expect(result).toMatchObject({
      externalRefId: ref.id,
      current: 'master',
      branches: ['main', 'release/docs']
    })
    expect(gitApi.fetch).not.toHaveBeenCalled()
    expect(gitApi.raw).toHaveBeenCalledWith(['branch', '-r', '--format=%(refname:short)'])
  })

  it('local 外部库不支持列分支', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const ref = await addExternalRef({
      alias: 'local-no-branches',
      category: 'knowledge',
      kind: 'local',
      sourcePath: src
    })

    await expect(listExternalRefBranches(ref.id))
      .rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('readExternalRefSyncStatus', () => {
  it('git 外部库 fetch 后计算远端落后提交数', async () => {
    const ref = await addExternalRef({
      alias: 'status-kb', category: 'knowledge', kind: 'git', url: 'https://example.com/kb.git'
    })
    gitApi.fetch.mockClear()
    gitApi.raw
      .mockResolvedValueOnce('origin/main\n')
      .mockResolvedValueOnce('2\n')

    const status = await readExternalRefSyncStatus(ref.id)

    expect(status).toMatchObject({
      externalRefId: ref.id,
      kind: 'git',
      ok: true,
      hasUpdates: true,
      behind: 2
    })
    expect(gitApi.fetch).toHaveBeenCalledWith(['--all', '--prune'])
    expect(gitApi.raw).toHaveBeenCalledWith(['rev-list', '--count', 'HEAD..origin/main'])
  })

  it('local 外部库不需要远端更新检测', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const ref = await addExternalRef({
      alias: 'status-local', category: 'knowledge', kind: 'local', sourcePath: src
    })

    await expect(readExternalRefSyncStatus(ref.id)).resolves.toMatchObject({
      externalRefId: ref.id,
      kind: 'local',
      ok: true,
      hasUpdates: false,
      behind: 0
    })
  })
})

describe('refreshAllExternalRefs / startAutoRefresh', () => {
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function waitForPullCalls(count: number, timeoutMs = 300): Promise<void> {
    const started = Date.now()
    while (gitApi.pull.mock.calls.length < count) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`expected at least ${count} pull calls, got ${gitApi.pull.mock.calls.length}`)
      }
      await sleep(5)
    }
  }

  it('定时同步只拉取 git 类型外部库，并覆盖知识库和 UI 资产库', async () => {
    const localSrc = mkdtempSync(join(tmpdir(), 'src-'))
    await addExternalRef({
      alias: 'auto-local-ui', category: 'uikit', kind: 'local', sourcePath: localSrc
    })
    const kb = await addExternalRef({
      alias: 'auto-remote-kb', category: 'knowledge', kind: 'git', url: 'https://example.com/kb.git'
    })
    const ui = await addExternalRef({
      alias: 'auto-remote-ui', category: 'uikit', kind: 'git', url: 'https://example.com/ui.git'
    })

    gitApi.pull.mockClear()
    const expectedGitCount = (await listExternalRefs()).filter((ref) => ref.kind === 'git').length
    await refreshAllExternalRefs()

    expect(gitApi.pull).toHaveBeenCalledTimes(expectedGitCount)
    const refs = await listExternalRefs()
    expect(refs.find((ref) => ref.id === kb.id)?.lastSyncedAt).toBeTruthy()
    expect(refs.find((ref) => ref.id === ui.id)?.lastSyncedAt).toBeTruthy()
    expect(refs.find((ref) => ref.alias === 'auto-local-ui')?.lastSyncedAt).toBeUndefined()
  })

  it('单个 git 外部库同步失败不影响其它外部库', async () => {
    await addExternalRef({
      alias: 'auto-fail-kb', category: 'knowledge', kind: 'git', url: 'https://example.com/kb.git'
    })
    const ui = await addExternalRef({
      alias: 'auto-fail-ui', category: 'uikit', kind: 'git', url: 'https://example.com/ui.git'
    })
    gitApi.pull
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined)

    const expectedGitCount = (await listExternalRefs()).filter((ref) => ref.kind === 'git').length
    await refreshAllExternalRefs()

    const refs = await listExternalRefs()
    expect(gitApi.pull).toHaveBeenCalledTimes(expectedGitCount)
    expect(refs.find((ref) => ref.alias === 'auto-fail-kb')?.lastSyncedAt)
      .toBeTruthy()
    expect(refs.find((ref) => ref.id === ui.id)?.lastSyncedAt).toBeTruthy()
  })

  it('startAutoRefresh 会启动延迟同步和周期同步，stop 后不再触发', async () => {
    await addExternalRef({
      alias: 'auto-timer-kb', category: 'knowledge', kind: 'git', url: 'https://example.com/kb.git'
    })
    gitApi.pull.mockClear()

    const expectedGitCount = (await listExternalRefs()).filter((ref) => ref.kind === 'git').length
    startAutoRefresh({ initialDelayMs: 0, intervalMs: 40 })

    await waitForPullCalls(expectedGitCount)
    await waitForPullCalls(expectedGitCount * 2)

    stopAutoRefresh()
    const afterStop = gitApi.pull.mock.calls.length
    await sleep(60)
    expect(gitApi.pull).toHaveBeenCalledTimes(afterStop)
  })

  it('默认自动更新间隔是 24 小时', () => {
    expect(EXTERNAL_AUTO_REFRESH_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('resource index refresh trigger', () => {
  it('手动构建会把资源加入索引队列', async () => {
    const src = await mkdtemp(join(tmpdir(), 'manual-index-'))
    const ref = await addExternalRef({
      alias: 'manual-index', category: 'knowledge', kind: 'local', sourcePath: src
    })
    scheduleResourceIndexBuildMock.mockClear()

    await expect(requestExternalRefIndexBuild(ref.id)).resolves.toMatchObject({
      externalRefId: ref.id,
      state: 'queued',
      reason: 'manual'
    })
    expect(scheduleResourceIndexBuildMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: ref.id }),
      'manual'
    )
  })

  it('Git HEAD 变化后自动重建索引，未变化时不重建', async () => {
    const ref = await addExternalRef({
      alias: 'indexed-kb', category: 'knowledge', kind: 'git', url: 'https://example.com/kb.git'
    })
    scheduleResourceIndexBuildMock.mockClear()
    let revision = 'aaaaaaaa'
    gitApi.pull.mockImplementationOnce(async () => { revision = 'bbbbbbbb' })
    gitApi.raw.mockImplementation(async (args?: string[]) => {
      if (args?.[0] === 'rev-parse' && args[1] === 'HEAD') return `${revision}\n`
      return 'refs/remotes/origin/main\n'
    })

    await expect(refreshExternalRef(ref.id)).resolves.toEqual({ ok: true })
    expect(scheduleResourceIndexBuildMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: ref.id }),
      'git-update'
    )

    scheduleResourceIndexBuildMock.mockClear()
    gitApi.pull.mockResolvedValueOnce(undefined)
    gitApi.raw.mockImplementation(async (args?: string[]) => {
      if (args?.[0] === 'rev-parse' && args[1] === 'HEAD') return 'bbbbbbbb\n'
      return 'refs/remotes/origin/main\n'
    })
    await expect(refreshExternalRef(ref.id)).resolves.toEqual({ ok: true })
    expect(scheduleResourceIndexBuildMock).not.toHaveBeenCalled()
  })
})

// 让 refsPath / REFS_FILENAME 不在导入里被打成"unused"（lint 友好）
void refsPath
void REFS_FILENAME
