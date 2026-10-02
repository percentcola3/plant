import { loadPushHistory } from '../../git/push-summary-notes'
import { submitFeatureDir } from '../../git/submit-feature'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { WorkspacesStore } from '../../workspaces/store'
import { gitFor, gitForBackground } from '../../git/client'
import { getSharedProbe } from '../../git/probe'
import { readLocalGitUser, setGlobalGitUser } from '../../git/identity'
import { askpassServer } from '../../http/askpass-server'
import type { GitCommitSummary, GitFileDiff, GitRevertToResult, GitSnapshot, GitStatus } from '@shared/types'
import { isAppManagedPath } from '@shared/app-managed-paths'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bindGitRepository, unbindGitRepository, listRemoteGitBranches, readGitCapability } from '../../git/capability'

const store = new WorkspacesStore()
const MAX_DIFF_CHARS = 24_000

function assertSafeRelPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').includes('..')) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', `路径越界：${relPath}`)
  }
  return normalized
}

function limitedHistoryCount(limit?: number): number {
  const parsed = Number.isFinite(limit) ? Math.trunc(limit ?? 30) : 30
  return Math.max(1, Math.min(parsed, 100))
}

function parseHistoryLine(line: string): GitCommitSummary | null {
  const [sha, shortSha, authorName, authorEmail, authoredAt, ...subjectParts] = line.split('\x1f')
  if (!sha || !shortSha || !authoredAt) return null
  return {
    sha,
    shortSha,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    authoredAt,
    subject: subjectParts.join('\x1f')
  }
}

function gitMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function limitDiff(path: string, diff: string): GitFileDiff {
  if (diff.length <= MAX_DIFF_CHARS) {
    return { path, diff, truncated: false }
  }
  return {
    path,
    diff: `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff 已截断，仅展示前 ${MAX_DIFF_CHARS} 个字符]`,
    truncated: true
  }
}

function isSafeCommitish(value: string): boolean {
  return /^[0-9a-fA-F]{4,40}$/.test(value)
}

export async function readWorkspaceSnapshot(workspaceId: string, force?: boolean): Promise<GitSnapshot> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  return getSharedProbe().snapshot(ws.path, ws.defaultBranch, { force })
}

// 旧 GitStatus 契约的兼容实现：从 GitSnapshot 投影。
// - isDirty 现在包含"未推送 commit"，与"两端模型"对齐（不只看工作树）
// - rebaseInProgress 真正反映 .git/rebase-merge 等异常态
// - stagedCount 永远为 0（应用内部不暴露暂存区概念）
export async function readWorkspaceStatus(workspaceId: string): Promise<GitStatus> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  let snap
  try {
    snap = await getSharedProbe().snapshot(ws.path, ws.defaultBranch)
  } catch {
    return {
      isDirty: false,
      modifiedCount: 0,
      stagedCount: 0,
      changedFiles: [],
      changedFileDetails: [],
      branch: ws.defaultBranch,
      ahead: 0,
      behind: 0,
      mainlineBehind: 0,
      hasRemote: false,
      rebaseInProgress: false,
      detached: false,
      headSha: ''
    }
  }
  return projectSnapshotToStatus(snap)
}

export async function readWorkspaceBranches(workspaceId: string): Promise<{ branches: string[]; current: string | null }> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  const summary = await gitFor(ws.path).branchLocal()
  const branches = Array.from(new Set(summary.all.filter((branch) => branch.trim().length > 0)))
  return {
    branches,
    current: summary.current || null
  }
}

function projectSnapshotToStatus(snap: GitSnapshot): GitStatus {
  const dirtyFiles = snap.working.kind === 'dirty' ? snap.working.files : []
  const changedFileDetails: GitStatus['changedFileDetails'] = dirtyFiles.map((f) => ({
    path: f.path,
    // GitStatus 旧契约只支持 added/deleted/modified；renamed/untracked 折叠回 added/modified
    kind: f.kind === 'deleted' ? 'deleted'
      : f.kind === 'untracked' || f.kind === 'added' ? 'added'
        : 'modified'
  }))
  const outgoing = snap.remote.kind === 'tracked' ? snap.remote.outgoing : 0
  const incoming = snap.remote.kind === 'tracked' ? snap.remote.incoming : 0
  const hasRemote = snap.remote.kind !== 'no-remote'
  const rebaseInProgress = snap.working.kind === 'rebasing'
  const detached = snap.working.kind === 'detached'
  return {
    isDirty: dirtyFiles.length > 0 || outgoing > 0,
    modifiedCount: dirtyFiles.length,
    stagedCount: 0,
    changedFiles: dirtyFiles.map((f) => f.path),
    changedFileDetails,
    branch: snap.branch,
    ahead: outgoing,
    behind: incoming,
    mainlineBehind: snap.mainlineIncoming,
    hasRemote,
    rebaseInProgress,
    detached,
    headSha: snap.headSha
  }
}

export async function restoreWorkspaceFile(workspaceId: string, relPath: string): Promise<void> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  const safeRelPath = assertSafeRelPath(relPath)
  if (isAppManagedPath(safeRelPath)) {
    throw new UIClientError('VALIDATION', `不能撤销应用内部文件：${safeRelPath}`)
  }

  const sg = gitFor(ws.path)
  const restoreError = await sg.raw(['restore', '--staged', '--worktree', '--', safeRelPath])
    .then(() => null)
    .catch((e: unknown) => e)
  const cleanError = await sg.raw(['clean', '-f', '--', safeRelPath])
    .then(() => null)
    .catch((e: unknown) => e)
  if (restoreError && cleanError) {
    const message = restoreError instanceof Error ? restoreError.message : String(restoreError)
    throw new UIClientError('GIT_FAILED', `撤销文件失败：${message}`)
  }
}

export async function readWorkspaceFileDiff(workspaceId: string, relPath: string): Promise<GitFileDiff> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  const safeRelPath = assertSafeRelPath(relPath)
  if (isAppManagedPath(safeRelPath)) {
    throw new UIClientError('VALIDATION', `不能读取应用内部文件 diff：${safeRelPath}`)
  }

  const sg = gitFor(ws.path)
  const cachedDiff = await sg.raw(['diff', '--cached', '--', safeRelPath]).catch(() => '')
  const workingDiff = await sg.raw(['diff', '--', safeRelPath]).catch(() => '')
  const diff = [cachedDiff, workingDiff].filter((part) => part.trim().length > 0).join('\n')
  if (diff.trim()) return limitDiff(safeRelPath, diff)

  const content = await readFile(join(ws.path, safeRelPath), 'utf-8')
    .then((text) => `未跟踪文件当前内容：\n--- ${safeRelPath}\n+++ ${safeRelPath}\n${text}`)
    .catch(() => '未检测到可展示的文本 diff。')
  return limitDiff(safeRelPath, content)
}

export async function readWorkspaceHistory(workspaceId: string, limit?: number): Promise<GitCommitSummary[]> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  const count = limitedHistoryCount(limit)
  const output = await gitFor(ws.path).raw([
    'log',
    `-${count}`,
    '--date=iso-strict',
    '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s'
  ])
  return output
    .split('\n')
    .map((line) => parseHistoryLine(line.trim()))
    .filter((item): item is GitCommitSummary => item !== null)
}

export async function revertWorkspaceToCommit(workspaceId: string, targetSha: string): Promise<GitRevertToResult> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  const safeTarget = targetSha.trim()
  if (!isSafeCommitish(safeTarget)) {
    return {
      ok: false,
      phase: 'resolve-target',
      code: 'VALIDATION',
      message: `版本号不合法：${targetSha}`
    }
  }

  const sg = gitFor(ws.path)
  const status = await sg.status()
  const branch = status.current || ws.defaultBranch
  if (status.detached === true) {
    return {
      ok: false,
      phase: 'check-clean',
      code: 'DETACHED_HEAD',
      message: '当前处于 detached HEAD，不能回滚',
      branch
    }
  }

  const businessFiles = (status.files ?? []).filter((file) => !isAppManagedPath(file.path))
  if (businessFiles.length > 0) {
    return {
      ok: false,
      phase: 'check-clean',
      code: 'UNCOMMITTED',
      message: '当前工作区有未保存改动；请先保存或撤销后再回滚',
      branch
    }
  }

  try {
    await sg.raw(['merge-base', '--is-ancestor', safeTarget, 'HEAD'])
  } catch (error) {
    return {
      ok: false,
      phase: 'resolve-target',
      code: 'NOT_ANCESTOR',
      message: gitMessage(error),
      branch
    }
  }

  let commits: string[]
  try {
    const output = await sg.raw(['rev-list', `${safeTarget}..HEAD`])
    commits = output.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch (error) {
    return {
      ok: false,
      phase: 'list-commits',
      code: 'GIT_FAILED',
      message: gitMessage(error),
      branch
    }
  }

  for (const sha of commits) {
    try {
      await sg.raw(['revert', '--no-edit', sha])
    } catch (error) {
      return {
        ok: false,
        phase: 'revert',
        code: 'GIT_FAILED',
        message: gitMessage(error),
        branch
      }
    }
  }
  return { ok: true, revertedCount: commits.length, branch }
}

export function registerGitHandlers(): void {
  registerIpcHandler('git.capability', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
    return readGitCapability(ws.path)
  })

  registerIpcHandler('git.remoteBranches', async ({ workspaceId, remoteUrl }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
    return listRemoteGitBranches(ws.path, remoteUrl)
  })

  registerIpcHandler('git.bind', async ({ workspaceId, remoteUrl, branch }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
    return bindGitRepository(ws.path, { remoteUrl, branch })
  })

  registerIpcHandler('git.unbind', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
    const result = await unbindGitRepository(ws.path)
    await store.updateWorkspace(ws.id, { remoteUrl: undefined })
    return result
  })

  registerIpcHandler('git.status', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return readWorkspaceStatus(workspaceId)
  })

  registerIpcHandler('git.branches', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return readWorkspaceBranches(workspaceId)
  })

  registerIpcHandler('git.snapshot', async ({ workspaceId, force }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return readWorkspaceSnapshot(workspaceId, force)
  })

  registerIpcHandler('git.restoreFile', async ({ workspaceId, relPath }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    await restoreWorkspaceFile(workspaceId, relPath)
  })

  registerIpcHandler('git.fileDiff', async ({ workspaceId, relPath }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    return readWorkspaceFileDiff(workspaceId, relPath)
  })

  registerIpcHandler('git.pushHistory', async ({ workspaceId, relPath, branch, retry }) => {
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', '工作区不存在')
    const git = await gitForBackground(ws.path, 15_000)
    return loadPushHistory(git, ws.path, { relPath: relPath ? assertSafeRelPath(relPath) : undefined, branch, retry })
  })

  registerIpcHandler('git.submitFeature', async ({ workspaceId, relDir }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!relDir) throw new UIClientError('VALIDATION', '缺少 relDir')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', '工作区不存在')
    return submitFeatureDir({
      workspacePath: ws.path,
      defaultBranch: ws.defaultBranch,
      relDir
    })
  })

  registerIpcHandler('git.history', async ({ workspaceId, limit }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return readWorkspaceHistory(workspaceId, limit)
  })

  registerIpcHandler('git.revertTo', async ({ workspaceId, targetSha }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!targetSha) throw new UIClientError('VALIDATION', '缺少 targetSha')
    return revertWorkspaceToCommit(workspaceId, targetSha)
  })

  registerIpcHandler('git.currentUser', async () => readLocalGitUser())

  registerIpcHandler('git.setIdentity', async ({ name, email }) => {
    await setGlobalGitUser({ name, email })
    return readLocalGitUser()
  })

  registerIpcHandler('askpass.respond', async ({ id, answer, rememberHost }) => {
    askpassServer.respond(id, answer, rememberHost ? { host: rememberHost } : undefined)
  })

  registerIpcHandler('askpass.cancel', async ({ id }) => {
    askpassServer.cancel(id)
  })

  registerIpcHandler('askpass.forget', async ({ host }) => {
    askpassServer.forgetHost(host)
  })

  registerIpcHandler('askpass.listCreds', async () => {
    return askpassServer.listCachedCreds()
  })

  registerIpcHandler('askpass.clearAll', async () => {
    await askpassServer.clearAllCreds()
  })

  registerIpcHandler('askpass.upsert', async ({ host, username, password }) => {
    const cleanHost = host?.trim()
    if (!cleanHost) throw new UIClientError('VALIDATION', '缺少 host')
    askpassServer.setCred(cleanHost, username?.trim(), password)
  })
}
