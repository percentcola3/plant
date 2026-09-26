import type { SimpleGit } from 'simple-git'
import type { GitPushSummary } from '../../shared/git-push-summary'
import { capturePushEvidence, type PushEvidence } from './push-summary-data'
import { storePushNote, syncPushNotes, withPushNotesLock } from './push-summary-notes'

export type PushHookOptions = { branch: string; source?: string; forceWithLease?: boolean; setUpstream?: boolean }
export type PushHookResult = { warning?: string; record?: GitPushSummary }

// All app push paths share these before/after hooks. Notes are only written once
// the branch push succeeds; the actual push is pinned to the captured commit.
export async function pushWithSummary(git: SimpleGit, cwd: string, options: PushHookOptions,
  summarize?: (evidence: PushEvidence) => Promise<GitPushSummary>): Promise<PushHookResult> {
  const source = options.source ?? options.branch
  let head = ''
  let evidence: PushEvidence | undefined
  let captureFailed = false
  let unchanged = false
  try {
    head = (await git.raw(['rev-parse', '--verify', `${source}^{commit}`])).trim()
    if (!/^[0-9a-f]{40,64}$/.test(head)) throw new Error('无法读取推送版本')
    const remoteOutput = await git.raw(['ls-remote', '--heads', 'origin', `refs/heads/${options.branch}`])
    const base = remoteOutput.trim().split(/\s+/)[0] || null
    unchanged = base === head
    if (!unchanged) {
      if (base) {
        await git.raw(['cat-file', '-e', `${base}^{commit}`]).catch(async () => { await git.fetch(['origin', `refs/heads/${options.branch}`]) })
      }
      evidence = await capturePushEvidence(git, options.branch, base, head)
    }
  } catch { captureFailed = true }

  const args = ['origin', head && /^[0-9a-f]{40,64}$/.test(head) ? `${head}:refs/heads/${options.branch}` : (source === options.branch ? source : `${source}:${options.branch}`)]
  if (options.forceWithLease) args.push('--force-with-lease')
  // Git cannot infer a local tracking branch from a SHA refspec.
  if (options.setUpstream && !head) args.unshift('-u')
  await git.push(args)
  if (evidence) evidence.record.pushedAt = new Date().toISOString()
  if (options.setUpstream && head && source !== 'HEAD') {
    await git.raw(['config', `branch.${source}.remote`, 'origin']).catch(() => undefined)
    await git.raw(['config', `branch.${source}.merge`, `refs/heads/${options.branch}`]).catch(() => undefined)
  }

  let warning: string | undefined = captureFailed ? '代码已推送，但无法读取本次变更，总结未生成。' : undefined
  let record = evidence?.record
  if (evidence) {
    try {
      const generate = summarize ?? (await import('./push-summary-ai')).summarizePush
      record = await generate(evidence)
    } catch { /* Preserve the explicitly labelled basic change list. */ }
  }
  try {
    await withPushNotesLock(git, cwd, async () => {
      if (record) await storePushNote(git, record)
      const sync = await syncPushNotes(git, 'origin', true)
      warning ??= sync.syncWarning
    })
  } catch { warning = '代码已推送，但共享变更记录保存失败。' }
  if (warning && !unchanged) void notifySummaryWarning(cwd, warning).catch(() => undefined)
  return { record, warning }
}

const warnedAt = new Map<string, number>()
async function notifySummaryWarning(cwd: string, message: string): Promise<void> {
  if (Date.now() - (warnedAt.get(cwd) ?? 0) < 300_000) return
  warnedAt.set(cwd, Date.now())
  const { BrowserWindow } = await import('electron')
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('git.push-summary-warning', { message })
}
