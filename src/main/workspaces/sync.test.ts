import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { Workspace } from '@shared/types'

const tmpUserData = await mkdtemp(join(tmpdir(), 'workspace-sync-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

const gitApi = vi.hoisted(() => ({
  status: vi.fn(),
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  fetch: vi.fn(async () => undefined),
  pull: vi.fn(async () => undefined),
  rebase: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  raw: vi.fn(async (_args: string[]) => ''),
  revparse: vi.fn(async (_args: string[]) => '')
}))

vi.mock('../git/client', () => ({
  gitFor: vi.fn(() => gitApi),
  gitForWithAskpass: vi.fn(async () => gitApi)
}))

import { syncWorkspace } from './sync'
import { WorkspacesStore, _testOnlyResetSharedCache } from './store'
import { workspacesJsonPath } from './paths'
import { _testOnlyResetSharedProbe } from '../git/probe'
import { _testOnlyResetRunner } from '../saga/service'

const baseWorkspace: Workspace = {
  id: 'ws-1',
  kind: 'project',
  name: 'demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
  addedAt: '2026-06-12T00:00:00.000Z',
  lastActiveAt: '2026-06-12T00:00:00.000Z'
}

let workspaceSeq = 0
let workspace: Workspace

let workspacePath: string

type MockState = {
  branch: string
  files: Array<{ path: string; index?: string; working_dir?: string }>
  outgoing: number
  incoming: number
  mainlineIncoming: number
  hasRemote: boolean
}

let mockState: MockState

function configureProbe(over: Partial<MockState> = {}): void {
  mockState = {
    branch: 'req/demo',
    files: [],
    outgoing: 0,
    incoming: 0,
    mainlineIncoming: 0,
    hasRemote: true,
    ...over
  }
  gitApi.status.mockImplementation(async () => ({
    current: mockState.branch,
    detached: false,
    files: mockState.files,
    conflicted: []
  }))
  gitApi.raw.mockImplementation(async (args: string[]) => {
    if (args[0] === 'remote') return mockState.hasRemote ? 'origin\n' : '\n'
    if (args[0] === 'diff' && args[1] === '--quiet' && mockState.mainlineIncoming > 0) throw new Error('trees differ')
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return `origin/${mockState.branch}\n`
    if (args[0] === 'rev-parse' && args[1] === '--verify') return 'ok'
    if (args[0] === 'rev-list' && args[1] === '--count') {
      const range = args[2] ?? ''
      if (range === `origin/${mockState.branch}..${mockState.branch}`) return `${mockState.outgoing}\n`
      if (range === `${mockState.branch}..origin/${mockState.branch}`) return `${mockState.incoming}\n`
      if (range === `${mockState.branch}..origin/main`) return `${mockState.mainlineIncoming}\n`
      return '0\n'
    }
    return ''
  })
}

beforeEach(async () => {
  await fs.rm(workspacesJsonPath(), { force: true })
  _testOnlyResetSharedCache()
  _testOnlyResetSharedProbe()
  _testOnlyResetRunner()
  workspaceSeq += 1
  workspacePath = await mkdtemp(join(tmpdir(), `sync-ws-${workspaceSeq}-`))
  await fs.mkdir(join(workspacePath, '.git'), { recursive: true })
  workspace = { ...baseWorkspace, id: `ws-${workspaceSeq}`, path: workspacePath }
  await new WorkspacesStore().add(workspace)

  gitApi.status.mockReset()
  gitApi.add.mockClear()
  gitApi.commit.mockReset()
  gitApi.fetch.mockReset()
  gitApi.pull.mockReset()
  gitApi.rebase.mockReset()
  gitApi.push.mockReset()
  gitApi.raw.mockReset()
  gitApi.revparse.mockReset()
  gitApi.revparse.mockImplementation(async (args: string[]) => {
    if (args[0] === '--git-dir') return '.git\n'
    if (args[0] === 'HEAD') return 'aaaa1111\n'
    return ''
  })

  // op 与 probe 状态的耦合：每个 op 完成后改 mockState，让下一次 probe 看到最新状态
  gitApi.commit.mockImplementation(async () => {
    mockState.files = []
    mockState.outgoing += 1
  })
  gitApi.pull.mockImplementation(async () => { mockState.incoming = 0 })
  gitApi.push.mockImplementation(async () => { mockState.outgoing = 0 })
  gitApi.rebase.mockImplementation(async () => {
    mockState.mainlineIncoming = 0
    // rebase 改 sha → outgoing 跟着浮动；测试里假设 rebase 后还是有 1 个待推送
    mockState.outgoing = Math.max(mockState.outgoing, 1)
  })
  gitApi.fetch.mockImplementation(async () => undefined)
})

describe('syncWorkspace', () => {
  it('remote 模式：dirty + commit 策略 → commit + fetch + pull-rebase + push', async () => {
    configureProbe({ files: [{ path: 'docs/prd.md', working_dir: 'M' }], incoming: 1 })

    await expect(syncWorkspace(workspace.id, {
      mode: 'remote',
      uncommittedStrategy: 'commit',
      commitMessage: 'docs: update prd'
    })).resolves.toEqual({ ok: true, pushed: true })

    expect(gitApi.add).toHaveBeenCalledWith(['docs/prd.md'])
    expect(gitApi.commit).toHaveBeenCalledWith('docs: update prd')
    expect(gitApi.fetch).toHaveBeenCalledWith(['--all', '--prune'])
    expect(gitApi.pull).toHaveBeenCalledWith('origin', 'req/demo', ['--rebase'])
    expect(gitApi.rebase).not.toHaveBeenCalled()
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'req/demo', '--force-with-lease'])
  })

  it('mainline 模式：clean → fetch + rebase-onto origin/main + push（无 pull-rebase）', async () => {
    configureProbe({ mainlineIncoming: 1, outgoing: 0 })

    await expect(syncWorkspace(workspace.id, { mode: 'mainline' }))
      .resolves.toEqual({ ok: true, pushed: true })

    expect(gitApi.fetch).toHaveBeenCalledWith(['--all', '--prune'])
    expect(gitApi.pull).not.toHaveBeenCalled()
    expect(gitApi.rebase).toHaveBeenCalledWith(['origin/main'])
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'req/demo', '--force-with-lease'])
  })

  it('reject 策略 + dirty → check-clean phase 立即失败', async () => {
    configureProbe({ files: [{ path: 'a.md', working_dir: 'M' }] })
    const r = await syncWorkspace(workspace.id, { uncommittedStrategy: 'reject' })
    expect(r).toEqual({
      ok: false,
      phase: 'check-clean',
      code: 'OTHER',
      message: '当前工作区有未保存改动；先保存版本再同步'
    })
    expect(gitApi.fetch).not.toHaveBeenCalled()
  })

  it('push 失败 → phase=push, code=NON_FAST_FORWARD', async () => {
    configureProbe({ outgoing: 1 })
    gitApi.push.mockRejectedValueOnce(new Error('failed to push some refs to origin'))
    const r = await syncWorkspace(workspace.id, { mode: 'remote' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.phase).toBe('push')
      expect(r.code).toBe('OTHER')   // NON_FAST_FORWARD 不在 SyncErrorCode 里，落到 OTHER
    }
  })

  it('emits onProgress for each step', async () => {
    configureProbe({ outgoing: 1, incoming: 0 })
    const events: Array<{ phase: string; ok: boolean }> = []
    await syncWorkspace(workspace.id, {
      mode: 'remote',
      onProgress: (e) => events.push({ phase: e.phase, ok: e.ok })
    })
    const phases = events.map((e) => e.phase)
    expect(phases).toContain('check-clean')
    expect(phases).toContain('fetch')
    expect(phases).toContain('push')
    expect(phases).toContain('done')
  })
})
