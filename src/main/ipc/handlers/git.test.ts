import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'

const tmpUserData = await mkdtemp(join(tmpdir(), 'git-handler-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

const gitApi = vi.hoisted(() => ({
  status: vi.fn(),
  branchLocal: vi.fn(async () => ({ all: ['main'], current: 'main' })),
  revparse: vi.fn(async () => 'abc123'),
  raw: vi.fn(async (args: string[]): Promise<string> => {
    if (args[0] === 'remote') return 'origin\n'
    if (args[0] === 'rev-parse') return 'ok'
    if (args[0] === 'rev-list') return '2\n'
    return ''
  })
}))

vi.mock('../../git/client', () => ({
  gitFor: vi.fn(() => gitApi)
}))

import * as gitHandlers from './git'
import { readWorkspaceBranches, readWorkspaceHistory, readWorkspaceStatus, restoreWorkspaceFile, revertWorkspaceToCommit } from './git'
import { WorkspacesStore, _testOnlyResetSharedCache } from '../../workspaces/store'
import { workspacesJsonPath } from '../../workspaces/paths'
import { _testOnlyResetSharedProbe } from '../../git/probe'
import { promises as fs } from 'node:fs'

const workspace: Workspace = {
  id: 'ws-1',
  kind: 'project',
  name: 'demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
  addedAt: '2026-06-11T00:00:00.000Z',
  lastActiveAt: '2026-06-11T00:00:00.000Z'
}

let workspaceSeq = 0
let workspaceId = workspace.id

beforeEach(async () => {
  gitApi.status.mockReset()
  gitApi.branchLocal.mockReset()
  gitApi.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
  gitApi.revparse.mockReset()
  gitApi.revparse.mockResolvedValue('abc123')
  gitApi.raw.mockReset()
  gitApi.raw.mockImplementation(async (args: string[]) => {
    if (args[0] === 'remote') return 'origin\n'
    if (args[0] === 'rev-parse') return 'ok'
    if (args[0] === 'rev-list') return '2\n'
    return ''
  })
  await fs.rm(workspacesJsonPath(), { force: true })
  _testOnlyResetSharedCache()
  _testOnlyResetSharedProbe()
  workspaceSeq += 1
  workspaceId = `ws-${workspaceSeq}`
  await new WorkspacesStore().add({ ...workspace, id: workspaceId })
})

describe('readWorkspaceHistory', () => {
  it('解析当前分支提交历史', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'log') {
        return [
          ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaa111', 'Alice', 'alice@example.com', '2026-06-11T10:00:00+08:00', 'feat: first'].join('\x1f'),
          ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'bbb222', 'Bob', 'bob@example.com', '2026-06-10T09:00:00+08:00', 'fix: second'].join('\x1f')
        ].join('\n')
      }
      return ''
    })

    await expect(readWorkspaceHistory(workspaceId, 2)).resolves.toEqual([
      {
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        shortSha: 'aaa111',
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        authoredAt: '2026-06-11T10:00:00+08:00',
        subject: 'feat: first'
      },
      {
        sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        shortSha: 'bbb222',
        authorName: 'Bob',
        authorEmail: 'bob@example.com',
        authoredAt: '2026-06-10T09:00:00+08:00',
        subject: 'fix: second'
      }
    ])
  })
})

describe('readWorkspaceBranches', () => {
  it('lists local branches for base branch selection', async () => {
    gitApi.branchLocal.mockResolvedValueOnce({
      all: ['main', 'req/abc-login', 'space/eric'],
      current: 'space/eric'
    })

    await expect(readWorkspaceBranches(workspaceId)).resolves.toEqual({
      branches: ['main', 'req/abc-login', 'space/eric'],
      current: 'space/eric'
    })
  })
})

describe('readWorkspaceStatus', () => {
  it('只把业务文件计入未保存状态', async () => {
    gitApi.status.mockResolvedValueOnce({
      isClean: () => false,
      current: 'req/5ccaa019-dinin',
      ahead: 0,
      behind: 0,
      detached: false,
      files: [
        { path: 'ui/点餐/index.html', index: 'M', working_dir: ' ' },
        { path: '.workspace/document-sessions/a.session-id', index: '?', working_dir: '?' },
        { path: '.ui-client/refs.json', index: '?', working_dir: '?' },
        { path: '.external/saas-ui', index: '?', working_dir: '?' },
        { path: 'AGENTS.md', index: 'M', working_dir: ' ' },
        { path: 'CLAUDE.md', index: 'M', working_dir: ' ' }
      ]
    })

    const status = await readWorkspaceStatus(workspaceId)

    expect(status.isDirty).toBe(true)
    expect(status.modifiedCount).toBe(1)
    expect(status.mainlineBehind).toBe(2)
    expect(status.changedFiles).toEqual(['ui/点餐/index.html'])
    expect(status.changedFileDetails).toEqual([
      { path: 'ui/点餐/index.html', kind: 'modified' }
    ])
  })

  it('把根目录外联配置计入业务变更', async () => {
    gitApi.status.mockResolvedValueOnce({
      isClean: () => false,
      current: 'master',
      ahead: 0,
      behind: 0,
      detached: false,
      files: [
        { path: 'workspace.external.json', index: '?', working_dir: '?' }
      ]
    })

    const status = await readWorkspaceStatus(workspaceId)

    expect(status.isDirty).toBe(true)
    expect(status.modifiedCount).toBe(1)
    expect(status.changedFiles).toEqual(['workspace.external.json'])
    expect(status.changedFileDetails).toEqual([
      { path: 'workspace.external.json', kind: 'added' }
    ])
  })
})

describe('restoreWorkspaceFile', () => {
  it('按单个业务文件撤销工作区改动', async () => {
    await restoreWorkspaceFile(workspaceId, 'ui/login/index.html')

    expect(gitApi.raw).toHaveBeenCalledWith(['restore', '--staged', '--worktree', '--', 'ui/login/index.html'])
    expect(gitApi.raw).toHaveBeenCalledWith(['clean', '-f', '--', 'ui/login/index.html'])
  })

  it('未跟踪文件 restore 失败但 clean 成功时视为已撤销', async () => {
    gitApi.raw.mockRejectedValueOnce(new Error('pathspec did not match any files'))

    await restoreWorkspaceFile(workspaceId, 'ui/new/index.html')

    expect(gitApi.raw).toHaveBeenCalledWith(['clean', '-f', '--', 'ui/new/index.html'])
  })

  it('Git restore 和 clean 都失败时返回错误', async () => {
    gitApi.raw
      .mockRejectedValueOnce(new Error('not a git repository'))
      .mockRejectedValueOnce(new Error('not a git repository'))

    await expect(restoreWorkspaceFile(workspaceId, 'ui/login/index.html'))
      .rejects.toMatchObject({ code: 'GIT_FAILED' })
  })

  it('拒绝撤销应用内部文件', async () => {
    await expect(restoreWorkspaceFile(workspaceId, '.ui-client/refs.json'))
      .rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('readWorkspaceFileDiff', () => {
  it('读取单个业务文件的工作区 diff', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'diff' && args[1] === '--cached') return ''
      if (args[0] === 'diff' && args.includes('--')) return 'diff --git a/docs/prd.md b/docs/prd.md\n+new\n'
      return ''
    })

    expect(typeof gitHandlers.readWorkspaceFileDiff).toBe('function')
    await expect(gitHandlers.readWorkspaceFileDiff(workspaceId, 'docs/prd.md'))
      .resolves.toEqual({
        path: 'docs/prd.md',
        diff: 'diff --git a/docs/prd.md b/docs/prd.md\n+new\n',
        truncated: false
      })
    expect(gitApi.raw).toHaveBeenCalledWith(['diff', '--', 'docs/prd.md'])
  })

  it('拒绝读取应用内部文件 diff', async () => {
    await expect(gitHandlers.readWorkspaceFileDiff(workspaceId, '.ui-client/refs.json'))
      .rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('revertWorkspaceToCommit', () => {
  it('工作区有业务改动时拒绝回滚', async () => {
    gitApi.status.mockResolvedValueOnce({
      isClean: () => false,
      current: 'req/demo',
      detached: false,
      files: [{ path: 'ui/a/index.html', index: 'M', working_dir: ' ' }]
    })

    await expect(revertWorkspaceToCommit(workspaceId, 'abc123'))
      .resolves.toMatchObject({ ok: false, phase: 'check-clean', code: 'UNCOMMITTED' })
  })

  it('detached HEAD 时拒绝回滚', async () => {
    gitApi.status.mockResolvedValueOnce({
      isClean: () => true,
      current: '',
      detached: true,
      files: []
    })

    await expect(revertWorkspaceToCommit(workspaceId, 'abc123'))
      .resolves.toMatchObject({ ok: false, phase: 'check-clean', code: 'DETACHED_HEAD' })
  })

  it('按从新到旧顺序 revert 目标之后的提交', async () => {
    gitApi.status.mockResolvedValueOnce({
      isClean: () => true,
      current: 'req/demo',
      detached: false,
      files: []
    })
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'merge-base') return ''
      if (args[0] === 'rev-list') return 'newest\nmiddle\n'
      return ''
    })

    await expect(revertWorkspaceToCommit(workspaceId, 'abcdef'))
      .resolves.toEqual({ ok: true, revertedCount: 2, branch: 'req/demo' })
    expect(gitApi.raw).toHaveBeenCalledWith(['revert', '--no-edit', 'newest'])
    expect(gitApi.raw).toHaveBeenCalledWith(['revert', '--no-edit', 'middle'])
  })
})
