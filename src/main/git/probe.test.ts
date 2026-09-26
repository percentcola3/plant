import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const gitApi = vi.hoisted(() => ({
  status: vi.fn(),
  raw: vi.fn(),
  revparse: vi.fn()
}))

vi.mock('./client', () => ({
  gitFor: vi.fn(() => gitApi)
}))

import { GitProbe, _testOnlyResetSharedProbe, getSharedProbe } from './probe'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'probe-'))
  await fs.mkdir(join(workspacePath, '.git'), { recursive: true })

  gitApi.status.mockReset()
  gitApi.raw.mockReset()
  gitApi.revparse.mockReset()
  gitApi.revparse.mockImplementation(async (args: string[]) => {
    if (args[0] === '--git-dir') return '.git\n'
    if (args[0] === 'HEAD') return 'aaaa1111\n'
    return ''
  })
  // 默认：有 remote、跟踪 origin/req-x、outgoing=0 / incoming=0、main 没新提交
  gitApi.raw.mockImplementation(async (args: string[]) => {
    if (args[0] === 'remote') return 'origin\n'
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'origin/req-x\n'
    if (args[0] === 'rev-parse' && args[1] === '--verify') return 'ok'
    if (args[0] === 'rev-list') return '0\n'
    return ''
  })
  gitApi.status.mockResolvedValue({
    current: 'req-x',
    detached: false,
    files: [],
    conflicted: []
  })
  _testOnlyResetSharedProbe()
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined)
})

describe('GitProbe.snapshot — working state', () => {
  it('reports clean when status has no business files', async () => {
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toEqual({ kind: 'clean' })
    expect(snap.branch).toBe('req-x')
    expect(snap.headSha).toBe('aaaa1111')
  })

  it('filters app-managed paths from dirty files', async () => {
    gitApi.status.mockResolvedValue({
      current: 'req-x',
      files: [
        { path: 'docs/a.md', index: ' ', working_dir: 'M' },
        { path: '.ui-client/sagas/x.json', index: ' ', working_dir: 'M' },
        { path: 'AGENTS.md', index: ' ', working_dir: 'M' }
      ],
      conflicted: []
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toEqual({
      kind: 'dirty',
      files: [{ path: 'docs/a.md', kind: 'modified' }]
    })
  })

  it('classifies file change kinds from porcelain codes', async () => {
    gitApi.status.mockResolvedValue({
      current: 'req-x',
      files: [
        { path: 'a.txt', index: '?', working_dir: '?' },
        { path: 'b.txt', index: 'A', working_dir: ' ' },
        { path: 'c.txt', index: ' ', working_dir: 'D' },
        { path: 'd.txt', index: 'R', working_dir: ' ' },
        { path: 'e.txt', index: ' ', working_dir: 'M' }
      ],
      conflicted: []
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toMatchObject({
      kind: 'dirty',
      files: [
        { path: 'a.txt', kind: 'untracked' },
        { path: 'b.txt', kind: 'added' },
        { path: 'c.txt', kind: 'deleted' },
        { path: 'd.txt', kind: 'renamed' },
        { path: 'e.txt', kind: 'modified' }
      ]
    })
  })

  it('detects rebase-merge in progress and reads progress files', async () => {
    const dir = join(workspacePath, '.git', 'rebase-merge')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'msgnum'), '2\n')
    await fs.writeFile(join(dir, 'end'), '5\n')
    gitApi.status.mockResolvedValue({
      current: 'req-x',
      files: [],
      conflicted: ['conflict.md']
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toEqual({
      kind: 'rebasing',
      step: 2,
      total: 5,
      conflicts: ['conflict.md']
    })
  })

  it('detects rebase-apply in progress', async () => {
    const dir = join(workspacePath, '.git', 'rebase-apply')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'next'), '1\n')
    await fs.writeFile(join(dir, 'last'), '3\n')
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toEqual({ kind: 'rebasing', step: 1, total: 3, conflicts: [] })
  })

  it('detects merging via MERGE_HEAD', async () => {
    await fs.writeFile(join(workspacePath, '.git', 'MERGE_HEAD'), 'aaa\n')
    gitApi.status.mockResolvedValue({
      current: 'main',
      files: [],
      conflicted: ['x.md']
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toEqual({ kind: 'merging', conflicts: ['x.md'] })
  })

  it('detects cherry-picking before merging marker', async () => {
    await fs.writeFile(join(workspacePath, '.git', 'CHERRY_PICK_HEAD'), 'aaa\n')
    await fs.writeFile(join(workspacePath, '.git', 'MERGE_HEAD'), 'aaa\n')
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working.kind).toBe('cherry-picking')
  })

  it('detects reverting via REVERT_HEAD', async () => {
    await fs.writeFile(join(workspacePath, '.git', 'REVERT_HEAD'), 'aaa\n')
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working.kind).toBe('reverting')
  })

  it('detects detached HEAD', async () => {
    gitApi.status.mockResolvedValue({
      current: null,
      detached: true,
      files: [],
      conflicted: []
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.working).toEqual({ kind: 'detached', headSha: 'aaaa1111' })
  })
})

describe('GitProbe.snapshot — remote state', () => {
  it('reports no-remote when git remote returns empty', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return '\n'
      return ''
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.remote).toEqual({ kind: 'no-remote' })
  })

  it('reports untracked-local when no upstream is set', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
        throw new Error('no upstream')
      }
      if (args[0] === 'rev-list') return '0\n'
      return ''
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.remote).toEqual({ kind: 'untracked-local' })
  })

  it('reports tracked with outgoing/incoming counts', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'origin/req-x\n'
      if (args[0] === 'rev-parse' && args[1] === '--verify') return 'ok'
      if (args[0] === 'rev-list' && args[2] === 'origin/req-x..req-x') return '3\n'
      if (args[0] === 'rev-list' && args[2] === 'req-x..origin/req-x') return '2\n'
      if (args[0] === 'rev-list') return '0\n'
      return ''
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.remote).toEqual({ kind: 'tracked', outgoing: 3, incoming: 2 })
  })
})

describe('GitProbe.snapshot — mainlineIncoming', () => {
  it('returns 0 when on default branch', async () => {
    gitApi.status.mockResolvedValue({ current: 'main', files: [], conflicted: [] })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.mainlineIncoming).toBe(0)
  })

  it('counts commits from origin/main relative to feature branch', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'origin/req-x\n'
      if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'origin/main') return 'ok'
      if (args[0] === 'rev-parse' && args[1] === '--verify') return 'ok'
      if (args[0] === 'diff' && args[1] === '--quiet') throw new Error('trees differ')
      if (args[0] === 'rev-list' && args[2] === 'req-x..origin/main') return '4\n'
      if (args[0] === 'rev-list') return '0\n'
      return ''
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.mainlineIncoming).toBe(4)
  })

  it('does not report team-space updates when branch and origin/main trees are identical', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'origin/req-x\n'
      if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'origin/main') return 'ok'
      if (args[0] === 'rev-parse' && args[1] === '--verify') return 'ok'
      if (args[0] === 'diff' && args[1] === '--quiet') return ''
      if (args[0] === 'rev-list' && args[2] === 'req-x..origin/main') return '2\n'
      if (args[0] === 'rev-list') return '0\n'
      return ''
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.mainlineIncoming).toBe(0)
  })

  it('falls back to local default branch when origin/<default> missing', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return '\n'
      if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'origin/main') {
        throw new Error('missing')
      }
      if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'main') return 'ok'
      if (args[0] === 'diff' && args[1] === '--quiet') throw new Error('trees differ')
      if (args[0] === 'rev-list' && args[2] === 'req-x..main') return '7\n'
      return ''
    })
    const snap = await new GitProbe({ ttlMs: 0 }).snapshot(workspacePath, 'main')
    expect(snap.mainlineIncoming).toBe(7)
  })
})

describe('GitProbe — caching', () => {
  it('serves second call from cache within TTL', async () => {
    const probe = new GitProbe({ ttlMs: 60_000 })
    const a = await probe.snapshot(workspacePath, 'main')
    const b = await probe.snapshot(workspacePath, 'main')
    expect(a).toBe(b)
    expect(gitApi.status).toHaveBeenCalledTimes(1)
  })

  it('force option bypasses cache', async () => {
    const probe = new GitProbe({ ttlMs: 60_000 })
    await probe.snapshot(workspacePath, 'main')
    await probe.snapshot(workspacePath, 'main', { force: true })
    expect(gitApi.status).toHaveBeenCalledTimes(2)
  })

  it('invalidate(path) drops cache for that workspace only', async () => {
    const probe = new GitProbe({ ttlMs: 60_000 })
    await probe.snapshot(workspacePath, 'main')
    probe.invalidate(workspacePath)
    await probe.snapshot(workspacePath, 'main')
    expect(gitApi.status).toHaveBeenCalledTimes(2)
  })

  it('expires after TTL', async () => {
    let now = 1_000
    const probe = new GitProbe({ ttlMs: 100, now: () => now })
    await probe.snapshot(workspacePath, 'main')
    now = 1_050
    await probe.snapshot(workspacePath, 'main')
    expect(gitApi.status).toHaveBeenCalledTimes(1)
    now = 1_200
    await probe.snapshot(workspacePath, 'main')
    expect(gitApi.status).toHaveBeenCalledTimes(2)
  })

  it('shared probe singleton survives module reload', () => {
    const a = getSharedProbe()
    const b = getSharedProbe()
    expect(a).toBe(b)
    _testOnlyResetSharedProbe()
    expect(getSharedProbe()).not.toBe(a)
  })
})
