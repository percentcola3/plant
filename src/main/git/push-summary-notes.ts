import { resolve } from 'node:path'
import type { SimpleGit } from 'simple-git'
import type { GitPushHistory, GitPushSummary } from '../../shared/git-push-summary'
import { INCOMING_NOTES_REF, PUSH_NOTES_REF, parsePushNote } from './push-summary-data'

const locks = new Map<string, Promise<unknown>>()
const identity = ['-c', 'user.name=Peeka', '-c', 'user.email=peeka@localhost']

export async function withPushNotesLock<T>(git: SimpleGit, cwd: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(cwd, (await git.raw(['rev-parse', '--git-common-dir'])).trim())
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(work)
  locks.set(key, next)
  try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
}

async function refSha(git: SimpleGit, ref: string): Promise<string> {
  return (await git.raw(['rev-parse', '--verify', ref]).catch(() => '')).trim()
}

export async function storePushNote(git: SimpleGit, record: GitPushSummary): Promise<void> {
  const existing = await git.raw(['notes', `--ref=${PUSH_NOTES_REF}`, 'show', record.headSha]).catch(() => '')
  if (parsePushNote(existing).some(r => r.id === record.id)) return
  // JSON stays on one line so concurrent notes can merge without losing records.
  await git.raw([...identity, 'notes', `--ref=${PUSH_NOTES_REF}`, 'append', '-m', JSON.stringify(record), record.headSha])
}

export async function syncPushNotes(git: SimpleGit, remote = 'origin', publish = false): Promise<{ pendingSync: boolean; syncWarning?: string }> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remoteOutput = await git.raw(['ls-remote', '--refs', remote, PUSH_NOTES_REF])
      const remoteSha = remoteOutput.trim().split(/\s+/)[0] || ''
      if (remoteSha) {
        await git.fetch([remote, `+${PUSH_NOTES_REF}:${INCOMING_NOTES_REF}`])
        const local = await refSha(git, PUSH_NOTES_REF)
        if (!local) await git.raw(['update-ref', PUSH_NOTES_REF, INCOMING_NOTES_REF])
        else if (local !== await refSha(git, INCOMING_NOTES_REF)) {
          await git.raw([...identity, 'notes', `--ref=${PUSH_NOTES_REF}`, 'merge', '-s', 'cat_sort_uniq', INCOMING_NOTES_REF])
        }
      }
      const local = await refSha(git, PUSH_NOTES_REF)
      if (!local || local === remoteSha) return { pendingSync: false }
      if (!publish) return { pendingSync: true }
      try {
        await git.raw(['push', remote, `${PUSH_NOTES_REF}:${PUSH_NOTES_REF}`])
        return { pendingSync: false }
      } catch (error) {
        if (attempt === 2 || !/rejected|non-fast-forward|fetch first/i.test(String(error))) throw error
      }
    }
  } catch {
    return { pendingSync: true, syncWarning: '共享推送记录暂未同步。代码推送不受影响，可稍后点击“重试同步记录”。' }
  }
  return { pendingSync: true }
}

export async function readPushNotes(git: SimpleGit, options: { relPath?: string; branch?: string; limit?: number } = {}): Promise<GitPushSummary[]> {
  if (!await refSha(git, PUSH_NOTES_REF)) return []
  // Read the notes history itself: force-push/rebase may make an older pushed
  // commit unreachable from HEAD, but its shared push record must remain visible.
  const changed = await git.raw(['log', '--first-parent', '--diff-merges=first-parent', '-500', '--format=', '--name-only', PUSH_NOTES_REF, '--'])
  const targets = [...new Set(changed.split('\n').map(line => line.trim().replace(/\//g, '')).filter(sha => /^[0-9a-f]{40,64}$/.test(sha)))].slice(0, 500)
  const listed = await git.raw(['notes', `--ref=${PUSH_NOTES_REF}`, 'list'])
  const blobs = new Map(listed.trim().split('\n').map(line => {
    const [blob, target] = line.trim().split(/\s+/)
    return [target, blob]
  }))
  const records: GitPushSummary[] = []
  for (let offset = 0; offset < targets.length; offset += 5) {
    const batch = targets.slice(offset, offset + 5).map(target => blobs.get(target)).filter((sha): sha is string => !!sha && /^[0-9a-f]{40,64}$/.test(sha))
    if (batch.length) records.push(...parsePushNote(await git.raw(['show', '--no-ext-diff', '--no-textconv', ...batch])))
  }
  const unique = new Map(records.map(record => [record.id, record]))
  const path = options.relPath?.trim()
  return [...unique.values()]
    .filter(record => !options.branch || record.branch === options.branch)
    .filter(record => !path || record.files.some(file => file.path === path || file.previousPath === path || file.path.startsWith(`${path}/`)))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
    .slice(0, Math.max(1, Math.min(options.limit ?? 30, 100)))
}

export async function loadPushHistory(git: SimpleGit, cwd: string, options: { relPath?: string; branch?: string; retry?: boolean } = {}): Promise<GitPushHistory> {
  return withPushNotesLock(git, cwd, async () => {
    const remotes = (await git.raw(['remote'])).split(/\s+/)
    const sync = remotes.includes('origin') ? await syncPushNotes(git, 'origin', options.retry) : { pendingSync: false }
    return { ...sync, records: await readPushNotes(git, options) }
  })
}
