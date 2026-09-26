import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { GitSnapshot } from '@shared/types'

const gitApi = vi.hoisted(() => ({
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  fetch: vi.fn(async () => undefined),
  pull: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  raw: vi.fn(async (_args: string[]) => '')
}))

vi.mock('./client', () => ({
  gitFor: vi.fn(() => gitApi),
  gitForWithAskpass: vi.fn(async () => gitApi)
}))

import {
  commitOp,
  fetchOp,
  pullRebaseOp,
  pushOp,
  squashUnpushedOp,
  wipMessage,
  isWipMessage,
  type OpContext
} from './ops'

function snap(over: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    workspacePath: '/tmp/ws',
    branch: 'req/x',
    defaultBranch: 'main',
    working: { kind: 'clean' },
    remote: { kind: 'tracked', outgoing: 0, incoming: 0 },
    mainlineIncoming: 0,
    headSha: 'aaa',
    takenAt: 0,
    ...over
  }
}

function ctx(s: GitSnapshot): OpContext {
  return { workspacePath: s.workspacePath, snapshot: s }
}

beforeEach(() => {
  gitApi.add.mockClear()
  gitApi.commit.mockClear()
  gitApi.fetch.mockClear()
  gitApi.pull.mockClear()
  gitApi.push.mockClear()
  gitApi.raw.mockReset()
  gitApi.raw.mockResolvedValue('')
})

describe('commitOp', () => {
  it('isSatisfied when working clean', () => {
    expect(commitOp.isSatisfied(ctx(snap()), { message: 'x' })).toBe(true)
  })

  it('isSatisfied false when dirty', () => {
    const s = snap({ working: { kind: 'dirty', files: [{ path: 'a.md', kind: 'modified' }] } })
    expect(commitOp.isSatisfied(ctx(s), { message: 'x' })).toBe(false)
  })

  it('adds business files and commits with message', async () => {
    const s = snap({
      working: {
        kind: 'dirty',
        files: [
          { path: 'docs/a.md', kind: 'modified' },
          { path: 'ui/b.css', kind: 'added' }
        ]
      }
    })
    const r = await commitOp.execute(ctx(s), { message: 'feat: x' })
    expect(r).toEqual({ ok: true, data: { committed: true, fileCount: 2 } })
    expect(gitApi.add).toHaveBeenCalledWith(['docs/a.md', 'ui/b.css'])
    expect(gitApi.commit).toHaveBeenCalledWith('feat: x')
  })

  it('isSatisfied for relDir when other paths are dirty', () => {
    const s = snap({ working: { kind: 'dirty', files: [{ path: 'other.md', kind: 'modified' }] } })
    expect(commitOp.isSatisfied(ctx(s), { message: 'x', relDir: 'features/foo' })).toBe(true)
  })

  it('scopes add and commit to relDir', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'diff') return 'features/foo/a.md\0'
      return ''
    })
    const s = snap({
      working: {
        kind: 'dirty',
        files: [
          { path: 'features/foo/a.md', kind: 'modified' },
          { path: 'other.md', kind: 'modified' }
        ]
      }
    })
    const r = await commitOp.execute(ctx(s), { message: '提交 foo', relDir: 'features/foo' })
    expect(r).toEqual({ ok: true, data: { committed: true, fileCount: 1 } })
    expect(gitApi.raw).toHaveBeenCalledWith(['add', '-A', '--', 'features/foo'])
    expect(gitApi.commit).toHaveBeenCalledWith('提交 foo', ['features/foo/a.md'])
    expect(gitApi.add).not.toHaveBeenCalled()
  })

  it('commits relDir even when snapshot looks clean', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'diff') return 'features/foo/a.md\0'
      return ''
    })
    const r = await commitOp.execute(ctx(snap()), { message: '提交 foo', relDir: 'features/foo' })
    expect(r).toEqual({ ok: true, data: { committed: true, fileCount: 1 } })
  })

  it('refuses empty commit message on dirty tree', async () => {
    const s = snap({ working: { kind: 'dirty', files: [{ path: 'a.md', kind: 'modified' }] } })
    const r = await commitOp.execute(ctx(s), { message: '   ' })
    expect(r).toEqual({ ok: false, failure: { kind: 'UNKNOWN', raw: 'commit message empty' } })
  })

  it('returns CONFLICT when in merging state', async () => {
    const s = snap({ working: { kind: 'merging', conflicts: ['x.md'] } })
    const r = await commitOp.execute(ctx(s), { message: 'm' })
    expect(r).toEqual({ ok: false, failure: { kind: 'CONFLICT', files: ['x.md'], during: 'merge' } })
  })

  it('returns REBASE_IN_PROGRESS when rebasing', async () => {
    const s = snap({ working: { kind: 'rebasing', step: 1, total: 3, conflicts: [] } })
    const r = await commitOp.execute(ctx(s), { message: 'm' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('REBASE_IN_PROGRESS')
  })

  it('classifies git error from commit', async () => {
    gitApi.commit.mockRejectedValueOnce(new Error('nothing to commit, working tree clean'))
    const s = snap({ working: { kind: 'dirty', files: [{ path: 'a', kind: 'modified' }] } })
    const r = await commitOp.execute(ctx(s), { message: 'm' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('NOTHING_TO_COMMIT')
  })

  it('wipMessage / isWipMessage round-trip', () => {
    const m = wipMessage('req/x', '2026-06-12T18:00:00Z')
    expect(m).toBe('wip(req/x): 2026-06-12T18:00:00Z')
    expect(isWipMessage(m)).toBe(true)
    expect(isWipMessage('feat: real commit')).toBe(false)
  })
})

describe('fetchOp', () => {
  it('isSatisfied when no remote', () => {
    expect(fetchOp.isSatisfied(ctx(snap({ remote: { kind: 'no-remote' } })), undefined as never)).toBe(true)
  })

  it('runs fetch --all --prune', async () => {
    const r = await fetchOp.execute(ctx(snap()), undefined as never)
    expect(r).toEqual({ ok: true, data: undefined })
    expect(gitApi.fetch).toHaveBeenCalledWith(['--all', '--prune'])
  })

  it('classifies network errors', async () => {
    gitApi.fetch.mockRejectedValueOnce(new Error('Could not resolve host: github.com'))
    const r = await fetchOp.execute(ctx(snap()), undefined as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('NETWORK')
  })

  it('skips when no remote', async () => {
    const r = await fetchOp.execute(ctx(snap({ remote: { kind: 'no-remote' } })), undefined as never)
    expect(r).toEqual({ ok: true, data: undefined })
    expect(gitApi.fetch).not.toHaveBeenCalled()
  })
})

describe('pullRebaseOp', () => {
  it('skips when remote untracked', () => {
    expect(pullRebaseOp.isSatisfied(ctx(snap({ remote: { kind: 'untracked-local' } })), undefined as never)).toBe(true)
  })

  it('skips when incoming = 0', () => {
    expect(pullRebaseOp.isSatisfied(ctx(snap()), undefined as never)).toBe(true)
  })

  it('runs when incoming > 0', () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 0, incoming: 2 } })
    expect(pullRebaseOp.isSatisfied(ctx(s), undefined as never)).toBe(false)
  })

  it('refuses to rebase on dirty tree', async () => {
    const s = snap({
      remote: { kind: 'tracked', outgoing: 0, incoming: 1 },
      working: { kind: 'dirty', files: [{ path: 'a.md', kind: 'modified' }] }
    })
    const r = await pullRebaseOp.execute(ctx(s), undefined as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toEqual({ kind: 'UNCOMMITTED', files: ['a.md'] })
  })

  it('runs pull --rebase against current branch', async () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 0, incoming: 1 } })
    const r = await pullRebaseOp.execute(ctx(s), undefined as never)
    expect(r).toEqual({ ok: true, data: undefined })
    expect(gitApi.pull).toHaveBeenCalledWith('origin', 'req/x', ['--rebase'])
  })

  it('classifies CONFLICT during rebase', async () => {
    gitApi.pull.mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in a.md\nrebase failed'))
    const s = snap({ remote: { kind: 'tracked', outgoing: 0, incoming: 1 } })
    const r = await pullRebaseOp.execute(ctx(s), undefined as never)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.kind).toBe('CONFLICT')
      if (r.failure.kind === 'CONFLICT') expect(r.failure.during).toBe('rebase')
    }
  })
})

describe('pushOp', () => {
  it('skips when no remote', () => {
    expect(pushOp.isSatisfied(ctx(snap({ remote: { kind: 'no-remote' } })), {})).toBe(true)
  })

  it('skips when outgoing = 0 on tracked', () => {
    expect(pushOp.isSatisfied(ctx(snap()), {})).toBe(true)
  })

  it('runs on untracked-local even with no commit count', () => {
    expect(pushOp.isSatisfied(ctx(snap({ remote: { kind: 'untracked-local' } })), {})).toBe(false)
  })

  it('runs when pushing a custom source even if outgoing is 0', () => {
    expect(pushOp.isSatisfied(ctx(snap()), { source: 'HEAD', branch: 'main' })).toBe(false)
  })

  it('uses -u origin <branch> for untracked-local', async () => {
    const s = snap({ remote: { kind: 'untracked-local' } })
    await pushOp.execute(ctx(s), {})
    expect(gitApi.push).toHaveBeenCalledWith(['-u', 'origin', 'req/x'])
  })

  it('plain push for default branch', async () => {
    const s = snap({ branch: 'main', remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    await pushOp.execute(ctx(s), {})
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'main'])
  })

  it('--force-with-lease for non-default branch', async () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    await pushOp.execute(ctx(s), {})
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'req/x', '--force-with-lease'])
  })

  it('pushes HEAD to default branch without force when asked', async () => {
    const s = snap({ branch: 'main', remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    await pushOp.execute(ctx(s), { source: 'HEAD', branch: 'main', setUpstream: false, forceWithLease: false })
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'HEAD:main'])
  })

  it('skips force-with-lease when caller disables it', async () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    await pushOp.execute(ctx(s), { forceWithLease: false })
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'req/x'])
  })

  it('classifies NON_FAST_FORWARD', async () => {
    gitApi.push.mockRejectedValueOnce(new Error('failed to push some refs to origin'))
    const s = snap({ branch: 'main', remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    const r = await pushOp.execute(ctx(s), {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('NON_FAST_FORWARD')
  })

  it('classifies AUTH', async () => {
    gitApi.push.mockRejectedValueOnce(new Error('Authentication failed for https://github.com/foo/bar.git'))
    const s = snap({ remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    const r = await pushOp.execute(ctx(s), {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toEqual({ kind: 'AUTH', host: 'github.com' })
  })
})

describe('squashUnpushedOp', () => {
  it('isSatisfied when tracked.outgoing = 0', () => {
    expect(squashUnpushedOp.isSatisfied(ctx(snap()), { message: 'm' })).toBe(true)
  })

  it('isSatisfied false when tracked.outgoing > 0', () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 2, incoming: 0 } })
    expect(squashUnpushedOp.isSatisfied(ctx(s), { message: 'm' })).toBe(false)
  })

  it('isSatisfied false when untracked-local (must run to count)', () => {
    expect(squashUnpushedOp.isSatisfied(ctx(snap({ remote: { kind: 'untracked-local' } })), { message: 'm' })).toBe(false)
  })

  it('refuses on dirty tree', async () => {
    const s = snap({
      working: { kind: 'dirty', files: [{ path: 'a.md', kind: 'modified' }] },
      remote: { kind: 'tracked', outgoing: 2, incoming: 0 }
    })
    const r = await squashUnpushedOp.execute(ctx(s), { message: 'release' })
    expect(r).toEqual({ ok: false, failure: { kind: 'UNCOMMITTED', files: ['a.md'] } })
  })

  it('amends when outgoing = 1', async () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    const r = await squashUnpushedOp.execute(ctx(s), { message: 'release' })
    expect(r).toEqual({ ok: true, data: undefined })
    expect(gitApi.raw).toHaveBeenCalledWith(['commit', '--amend', '-m', 'release'])
  })

  it('reset --soft + commit when outgoing > 1', async () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 3, incoming: 0 } })
    await squashUnpushedOp.execute(ctx(s), { message: 'release' })
    expect(gitApi.raw).toHaveBeenCalledWith(['reset', '--soft', 'HEAD~3'])
    expect(gitApi.raw).toHaveBeenCalledWith(['commit', '-m', 'release'])
  })

  it('noop when no unpushed commits (tracked, outgoing=0)', async () => {
    const r = await squashUnpushedOp.execute(ctx(snap()), { message: 'release' })
    expect(r).toEqual({ ok: true, data: undefined })
    expect(gitApi.raw).not.toHaveBeenCalled()
  })

  it('counts via rev-list for no-remote on feature branch', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-list' && args[2] === 'main..req/x') return '2\n'
      return ''
    })
    const s = snap({ remote: { kind: 'no-remote' } })
    await squashUnpushedOp.execute(ctx(s), { message: 'release' })
    expect(gitApi.raw).toHaveBeenCalledWith(['rev-list', '--count', 'main..req/x'])
    expect(gitApi.raw).toHaveBeenCalledWith(['reset', '--soft', 'HEAD~2'])
    expect(gitApi.raw).toHaveBeenCalledWith(['commit', '-m', 'release'])
  })

  it('refuses empty message', async () => {
    const s = snap({ remote: { kind: 'tracked', outgoing: 1, incoming: 0 } })
    const r = await squashUnpushedOp.execute(ctx(s), { message: '   ' })
    expect(r).toEqual({ ok: false, failure: { kind: 'UNKNOWN', raw: 'squash message empty' } })
  })
})
