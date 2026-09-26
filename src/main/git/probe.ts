import { promises as fs } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import type { SimpleGit } from 'simple-git'
import type {
  GitChangedFile,
  GitRemoteState,
  GitSnapshot,
  GitWorkingState
} from '@shared/types'
import { isAppManagedPath } from '@shared/app-managed-paths'
import { gitFor } from './client'

// 唯一 git 真相来源。所有 saga / IPC handler 都从这里取状态。
// 缓存策略：每 workspace 独立 TTL（默认 2s），同一 saga 的多次读复用一次实际 io。

const DEFAULT_TTL_MS = 2_000

type CacheEntry = { snapshot: GitSnapshot; expiresAt: number }

export class GitProbe {
  private cache = new Map<string, CacheEntry>()
  private ttlMs: number
  private now: () => number

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? (() => Date.now())
  }

  invalidate(workspacePath: string): void {
    this.cache.delete(workspacePath)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  async snapshot(
    workspacePath: string,
    defaultBranch: string,
    opts: { force?: boolean } = {}
  ): Promise<GitSnapshot> {
    const t = this.now()
    if (!opts.force) {
      const hit = this.cache.get(workspacePath)
      if (hit && hit.expiresAt > t) return hit.snapshot
    }
    const snap = await readSnapshot(workspacePath, defaultBranch, t)
    this.cache.set(workspacePath, { snapshot: snap, expiresAt: t + this.ttlMs })
    return snap
  }
}

async function readSnapshot(
  workspacePath: string,
  defaultBranch: string,
  takenAt: number
): Promise<GitSnapshot> {
  const sg = gitFor(workspacePath)
  const status = await sg.status()
  const branch = status.current ?? defaultBranch
  const headSha = await sg.revparse(['HEAD']).then((s) => s.trim()).catch(() => '')
  const gitDir = await resolveGitDir(sg, workspacePath)

  const working = await detectWorkingState(gitDir, status, headSha)
  const remote = await detectRemoteState(sg, branch)
  const mainlineIncoming = await countMainlineIncoming(sg, branch, defaultBranch)

  return {
    workspacePath,
    branch,
    defaultBranch,
    working,
    remote,
    mainlineIncoming,
    headSha,
    takenAt
  }
}

async function resolveGitDir(sg: SimpleGit, workspacePath: string): Promise<string> {
  try {
    const out = (await sg.revparse(['--git-dir'])).trim()
    return isAbsolute(out) ? out : resolve(workspacePath, out)
  } catch {
    return join(workspacePath, '.git')
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

type SimpleStatus = Awaited<ReturnType<SimpleGit['status']>>

async function detectWorkingState(
  gitDir: string,
  status: SimpleStatus,
  headSha: string
): Promise<GitWorkingState> {
  const conflicts = (status.conflicted ?? []).slice()

  if (await pathExists(join(gitDir, 'rebase-merge'))) {
    const { step, total } = await readRebaseMergeProgress(gitDir)
    return { kind: 'rebasing', step, total, conflicts }
  }
  if (await pathExists(join(gitDir, 'rebase-apply'))) {
    const { step, total } = await readRebaseApplyProgress(gitDir)
    return { kind: 'rebasing', step, total, conflicts }
  }
  if (await pathExists(join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return { kind: 'cherry-picking', conflicts }
  }
  if (await pathExists(join(gitDir, 'REVERT_HEAD'))) {
    return { kind: 'reverting', conflicts }
  }
  if (await pathExists(join(gitDir, 'MERGE_HEAD'))) {
    return { kind: 'merging', conflicts }
  }
  if (status.detached === true) {
    return { kind: 'detached', headSha }
  }

  const files = businessFiles(status)
  if (files.length === 0) return { kind: 'clean' }
  return { kind: 'dirty', files }
}

async function readRebaseMergeProgress(gitDir: string): Promise<{ step: number; total: number }> {
  const dir = join(gitDir, 'rebase-merge')
  const msgnum = await readIntFile(join(dir, 'msgnum'))
  const end = await readIntFile(join(dir, 'end'))
  return { step: msgnum, total: end }
}

async function readRebaseApplyProgress(gitDir: string): Promise<{ step: number; total: number }> {
  const dir = join(gitDir, 'rebase-apply')
  const next = await readIntFile(join(dir, 'next'))
  const last = await readIntFile(join(dir, 'last'))
  return { step: next, total: last }
}

async function readIntFile(path: string): Promise<number> {
  try {
    const text = await fs.readFile(path, 'utf-8')
    const n = parseInt(text.trim(), 10)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function businessFiles(status: SimpleStatus): GitChangedFile[] {
  const out: GitChangedFile[] = []
  for (const f of status.files ?? []) {
    if (isAppManagedPath(f.path)) continue
    const code = `${f.index ?? ''}${f.working_dir ?? ''}`
    let kind: GitChangedFile['kind']
    if (code.includes('?')) kind = 'untracked'
    else if (code.includes('R')) kind = 'renamed'
    else if (code.includes('D')) kind = 'deleted'
    else if (code.includes('A')) kind = 'added'
    else kind = 'modified'
    out.push({ path: f.path, kind })
  }
  return out
}

async function detectRemoteState(sg: SimpleGit, branch: string): Promise<GitRemoteState> {
  const hasRemote = await sg.raw(['remote']).then((s) => s.trim().length > 0).catch(() => false)
  if (!hasRemote) return { kind: 'no-remote' }
  const upstream = await sg
    .raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{u}`])
    .then((s) => s.trim())
    .catch(() => '')
  if (!upstream) return { kind: 'untracked-local' }
  const outgoing = await countRevList(sg, `${upstream}..${branch}`)
  const incoming = await countRevList(sg, `${branch}..${upstream}`)
  return { kind: 'tracked', outgoing, incoming }
}

async function countMainlineIncoming(
  sg: SimpleGit,
  branch: string,
  defaultBranch: string
): Promise<number> {
  if (branch === defaultBranch) return 0
  const remoteRef = `origin/${defaultBranch}`
  const exists = await sg.raw(['rev-parse', '--verify', remoteRef]).then(() => true).catch(() => false)
  const ref = exists
    ? remoteRef
    : (await sg.raw(['rev-parse', '--verify', defaultBranch]).then(() => defaultBranch).catch(() => ''))
  if (!ref) return 0
  if (await sameTree(sg, branch, ref)) return 0
  return countRevList(sg, `${branch}..${ref}`)
}

async function sameTree(sg: SimpleGit, left: string, right: string): Promise<boolean> {
  return sg.raw(['diff', '--quiet', left, right, '--']).then(() => true).catch(() => false)
}

async function countRevList(sg: SimpleGit, range: string): Promise<number> {
  return sg
    .raw(['rev-list', '--count', range])
    .then((s) => {
      const n = parseInt(s.trim(), 10)
      return Number.isFinite(n) ? n : 0
    })
    .catch(() => 0)
}

let sharedProbe: GitProbe | null = null

export function getSharedProbe(): GitProbe {
  if (!sharedProbe) sharedProbe = new GitProbe()
  return sharedProbe
}

export function _testOnlyResetSharedProbe(): void {
  sharedProbe = null
}
