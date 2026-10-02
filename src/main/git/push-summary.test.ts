import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { simpleGit } from 'simple-git'
import { pushWithSummary } from './push-with-summary'
import { capturePushEvidence, applyAiSummary, parseChangedFiles, PUSH_NOTES_REF } from './push-summary-data'
import { loadPushHistory, readPushNotes, storePushNote, syncPushNotes } from './push-summary-notes'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'plant-push-test-')); roots.push(root)
  const bare = join(root, 'remote.git'), a = join(root, 'alice'), b = join(root, 'bob')
  await mkdir(bare); await mkdir(a)
  await simpleGit(bare).raw(['init', '--bare', '--initial-branch=main'])
  await simpleGit({ baseDir: bare, unsafe: { allowUnsafeHooksPath: true } }).addConfig('core.hooksPath', join(bare, 'hooks'))
  const git = simpleGit(a)
  await git.raw(['init', '--initial-branch=main'])
  await git.addConfig('user.name', 'Alice'); await git.addConfig('user.email', 'alice@example.com')
  await writeFile(join(a, 'PRD.md'), '# Login\nOld version\n'); await git.add('PRD.md'); await git.commit('initial')
  await git.addRemote('origin', bare); await git.push(['-u', 'origin', 'main'])
  await simpleGit().clone(bare, b)
  const peer = simpleGit(b)
  await peer.addConfig('user.name', 'Bob'); await peer.addConfig('user.email', 'bob@example.com')
  return { root, bare, a, b, git, peer }
}

describe('push summary hooks with real Git', () => {
  it('shares an AI summary with another clone without changing commits, the worktree or index', async () => {
    const { a, b, git, peer } = await setup()
    await writeFile(join(a, 'PRD.md'), '# Login\nAdded password reset.\n'); await git.add('PRD.md'); await git.commit('wip(save): now')
    const head = (await git.revparse(['HEAD'])).trim()
    await writeFile(join(a, 'private-draft.md'), 'not pushed'); await git.add('private-draft.md')
    const indexBefore = await git.raw(['diff', '--cached'])
    const result = await pushWithSummary(git, a, { branch: 'main' }, async evidence => applyAiSummary(evidence.record,
      JSON.stringify({ summary: '登录文档增加密码重置说明', files: [{ path: 'PRD.md', summary: '补充密码重置流程' }] })))
    expect(result.warning).toBeUndefined()
    expect(await git.raw(['diff', '--cached'])).toBe(indexBefore)
    expect((await git.revparse(['HEAD'])).trim()).toBe(head)
    await peer.pull()
    const history = await loadPushHistory(peer, b, { relPath: 'PRD.md' })
    expect(history.records).toHaveLength(1)
    expect(history.records[0]).toMatchObject({ headSha: head, source: 'ai', summary: '登录文档增加密码重置说明' })
    expect(history.records[0].files).toEqual([{ path: 'PRD.md', change: 'modified', summary: '补充密码重置流程' }])
    expect(await readPushNotes(peer, { relPath: 'other.md' })).toEqual([])
    // History is kept even after a branch reset makes the pushed tip unreachable.
    await peer.raw(['reset', '--hard', 'HEAD^'])
    expect((await readPushNotes(peer, { relPath: 'PRD.md' }))[0].headSha).toBe(head)
  })

  it('never generates or publishes a summary for a rejected code push', async () => {
    const { a, git, peer } = await setup()
    await writeFile(join(a, 'PRD.md'), 'alice'); await git.add('.'); await git.commit('alice')
    // Advance the remote independently.
    await peer.raw(['commit', '--allow-empty', '-m', 'bob']); await peer.push('origin', 'main')
    const ai = vi.fn()
    await expect(pushWithSummary(git, a, { branch: 'main' }, ai)).rejects.toThrow()
    expect(ai).not.toHaveBeenCalled()
    expect((await git.raw(['ls-remote', 'origin', PUSH_NOTES_REF])).trim()).toBe('')
  })

  it('keeps a basic record when AI fails and retries unsynced notes without re-pushing code', async () => {
    const { a, b, git, peer, bare } = await setup()
    await writeFile(join(a, 'PRD.md'), 'new'); await git.add('.'); await git.commit('update')
    // Reject only the notes ref on the server.
    const hook = join(bare, 'hooks/pre-receive')
    await writeFile(hook, '#!/bin/sh\nwhile read old new ref; do\n case "$ref" in refs/notes/*) exit 1;; esac\ndone\n', { mode: 0o755 })
    const result = await pushWithSummary(git, a, { branch: 'main' }, async () => { throw new Error('offline') })
    expect(result.warning).toContain('记录暂未同步')
    expect((await readPushNotes(git))[0].source).toBe('basic')
    await rm(hook)
    expect(await syncPushNotes(git, 'origin', true)).toEqual({ pendingSync: false })
    await peer.pull()
    expect((await loadPushHistory(peer, b)).records).toHaveLength(1)
  })

  it('merges concurrent users notes instead of force-overwriting them', async () => {
    const { a, git, peer } = await setup()
    const head = (await git.revparse(['HEAD'])).trim()
    const evidence = await capturePushEvidence(git, 'main', null, head)
    await storePushNote(git, { ...evidence.record, id: 'alice', summary: 'alice record' })
    await storePushNote(peer, { ...evidence.record, id: 'bob', summary: 'bob record' })
    expect(await syncPushNotes(git, 'origin', true)).toEqual({ pendingSync: false })
    expect(await syncPushNotes(peer, 'origin', true)).toEqual({ pendingSync: false })
    const history = await loadPushHistory(git, a)
    expect(history.records.map(r => r.id).sort()).toEqual(['alice', 'bob'])
  })

  it('parses renamed and deleted document paths', () => {
    expect(parseChangedFiles('R100\0old name.md\0new name.md\0D\0gone.md\0')).toMatchObject([
      { path: 'new name.md', previousPath: 'old name.md', change: 'renamed' }, { path: 'gone.md', change: 'deleted' }
    ])
  })
})
