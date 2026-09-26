// 推送到团队空间（= 远端主分支 origin/main）。
//
// 后台用临时 git worktree 把工作空间里某个对象目录（feature / outputs）落到 main 并 push，
// 全程不动用户工作树。设计见 docs/superpowers/specs/2026-06-29-team-space-design.md §3。
//
// 不走通用 saga runner：runner 绑的是工作空间路径，临时 worktree 需要自己编排进度 /
// 冲突保留。推送本身仍走 pushOp（HEAD → origin/<defaultBranch>，永不 force）。
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { gitFor, gitForWithAskpass } from '../git/client'
import { addWorktree, listWorktrees, removeWorktree } from '../git/worktree'
import { classifyError, type GitFailure } from '../git/failures'
import { getSharedProbe } from '../git/probe'
import { pushOp } from '../git/ops'
import { isAppManagedPath } from '@shared/app-managed-paths'
import { WorkspacesStore } from './store'
import { UIClientError } from '../ipc/errors'

const store = new WorkspacesStore()

export type TeamPushTargetType = 'feat' | 'ui'

export type TeamPushTarget = {
  relPath: string                 // 相对工作空间根，如 'features/login' / 'outputs/checkout'
  name: string                    // 显示名（commit message / toast 用）
  type: TeamPushTargetType
}

export type TeamPushPhase = 'fetch' | 'add-worktree' | 'mirror' | 'stage' | 'commit' | 'push' | 'reconcile' | 'done'

export type TeamPushProgressEvent = {
  workspaceId: string
  phase: TeamPushPhase
  ok: boolean
  message?: string
}

export type TeamPushOutcome =
  | { ok: true; pushed: boolean; empty: boolean }
  | {
      ok: false
      phase: TeamPushPhase
      code: 'CONFLICT' | 'AUTH' | 'NETWORK' | 'NO_REMOTE' | 'OTHER'
      message: string
      worktreePath?: string
      conflictFiles?: string[]
    }

export type TeamPushOptions = { onProgress?: (e: TeamPushProgressEvent) => void }

// worktree 根：<userData>/teamspace-push/<workspaceId>/<runId>
export function teamPushRoot(): string {
  return join(app.getPath('userData'), 'teamspace-push')
}

export function teamPushWorktreeDir(workspaceId: string, runId: string): string {
  return join(teamPushRoot(), workspaceId, runId)
}

// 用户放弃冲突：先 rebase --abort（若 rebase 进行中），再 worktree remove。
export async function abortTeamPush(workspaceId: string, worktreePath: string): Promise<void> {
  const ws = await store.findById(workspaceId).catch(() => null)
  if (!ws) {
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
    return
  }
  await gitFor(worktreePath).raw(['rebase', '--abort']).catch(() => undefined)
  await removeWorktree(ws.path, worktreePath)
}

// 启动时清理孤儿 worktree 目录。规则（保守，绝不误删冲突 worktree）：
// - 工作区已不存在（removeWorkspace 后）→ 整个 <workspaceId>/ 子树删
// - 工作区还在，但某个 runId 目录已不在 `git worktree list`（git 已 prune，纯崩溃残留）→ 删
// - 仍在 worktree list 的目录一律保留（可能是上次冲突留给 AI 的）
export async function cleanupOrphanTeamPushWorktrees(): Promise<void> {
  const root = teamPushRoot()
  let wsIdEntries: import('node:fs').Dirent[]
  try { wsIdEntries = await fs.readdir(root, { withFileTypes: true }) } catch { return }

  for (const wsIdEntry of wsIdEntries) {
    if (!wsIdEntry.isDirectory()) continue
    const workspaceId = wsIdEntry.name
    const wsDir = join(root, workspaceId)
    const ws = await store.findById(workspaceId).catch(() => null)

    let knownWorktrees = new Set<string>()
    if (ws) {
      const entries = await listWorktrees(ws.path)
      knownWorktrees = new Set(entries.map((e) => e.path))
    }

    let runEntries: import('node:fs').Dirent[]
    try { runEntries = await fs.readdir(wsDir, { withFileTypes: true }) } catch { continue }
    for (const run of runEntries) {
      if (!run.isDirectory()) continue
      const dir = join(wsDir, run.name)
      // 工作区没了，或该目录已不在 worktree list → 孤儿，删
      if (!ws || !knownWorktrees.has(dir)) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    const remaining = await fs.readdir(wsDir).catch(() => [])
    if (remaining.length === 0) await fs.rmdir(wsDir).catch(() => undefined)
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true } catch { return false }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function codeOf(f: GitFailure): 'CONFLICT' | 'AUTH' | 'NETWORK' | 'OTHER' {
  if (f.kind === 'CONFLICT') return 'CONFLICT'
  if (f.kind === 'AUTH') return 'AUTH'
  if (f.kind === 'NETWORK') return 'NETWORK'
  return 'OTHER'
}

// push 阶段不会产生 CONFLICT（冲突在 rebase 时显式处理）；其余失败一律归到这里。
function nonConflictCode(f: GitFailure): 'AUTH' | 'NETWORK' | 'OTHER' {
  return f.kind === 'AUTH' ? 'AUTH' : f.kind === 'NETWORK' ? 'NETWORK' : 'OTHER'
}

function msgOf(f: GitFailure): string {
  if (f.kind === 'UNKNOWN') return f.raw
  if (f.kind === 'NETWORK') return f.detail
  return f.kind
}

function commitMessage(target: TeamPushTarget): string {
  return [
    `${target.type}: 推送 ${target.name} 到团队空间`,
    '',
    `来源：工作空间`,
    `路径：${target.relPath}`
  ].join('\n')
}

// 镜像时排除的条目：AI 脚手架（feature 目录里的 AI link / 受管文件）+ app 受管路径。
// 这些机器/会话相关文件不该进团队空间，否则队友 pull 后 rebase 必撞。
// 关键：排除 = 既不从源覆盖、也不在目标删除，让团队空间里这些文件保持原样（不动）。
const TEAM_PUSH_EXCLUDED_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'system.md', '.claude', '.agents', '.cursor'])

function isTeamPushExcludedEntry(name: string): boolean {
  return TEAM_PUSH_EXCLUDED_NAMES.has(name) || isAppManagedPath(name)
}

// 镜像源目录到目标：覆盖 + 删除目标里源没有的条目（last-write-wins），但跳过排除项。
// 源不存在 → 删光目标（团队空间里这个对象整体移除）。
export async function mirrorDir(src: string, dst: string): Promise<void> {
  if (!await pathExists(src)) {
    await fs.rm(dst, { recursive: true, force: true }).catch(() => undefined)
    return
  }
  await fs.mkdir(dst, { recursive: true })
  await copyMirror(src, dst)
  await pruneExtra(src, dst)
}

// 递归拷贝源→目标，跳过排除项（排除项保留目标原样，不覆盖）。
async function copyMirror(src: string, dst: string): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try { entries = await fs.readdir(src, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (isTeamPushExcludedEntry(entry.name)) continue
    const srcChild = join(src, entry.name)
    const dstChild = join(dst, entry.name)
    if (entry.isDirectory()) {
      await fs.mkdir(dstChild, { recursive: true })
      await copyMirror(srcChild, dstChild)
    } else {
      await fs.cp(srcChild, dstChild, { force: true }).catch(() => undefined)
    }
  }
}

// 删除目标里源没有的条目；排除项不删（保留团队空间原样）；目录递归。
async function pruneExtra(src: string, dst: string): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try { entries = await fs.readdir(dst, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (isTeamPushExcludedEntry(entry.name)) continue
    const srcChild = join(src, entry.name)
    const dstChild = join(dst, entry.name)
    if (!await pathExists(srcChild)) {
      await fs.rm(dstChild, { recursive: true, force: true }).catch(() => undefined)
    } else if (entry.isDirectory()) {
      await pruneExtra(srcChild, dstChild)
    }
  }
}

// 推送成功后 reconcile 工作空间分支到 origin/main，消除「公共空间有更新」误报。
// 流程：dirty 先 wip 提交业务改动 → fetch（拿刚推的 commit）→ rebase 分支到 origin/main。
// 全程停留当前分支（rebase 不切分支）。推上去的就是分支内容，rebase 识别「已应用」跳过，
// 结果 mainlineIncoming 归零。内容一致理应无冲突；万一撞了 abort 保平安（推送已成功）。
// 返回 false 仅表示自动同步没成（误报可能仍在），不影响推送结果。
async function reconcileAfterPush(workspacePath: string, defaultBranch: string): Promise<boolean> {
  const sg = gitFor(workspacePath)
  try {
    const status = await sg.status()
    if (!status.isClean()) {
      const changed = (status.files ?? []).map((f) => f.path).filter((p) => p && !isAppManagedPath(p))
      if (changed.length > 0) {
        await sg.add(changed)
        await sg.commit('wip: 推送团队空间后对齐快照')
      }
    }
    await (await gitForWithAskpass(workspacePath)).fetch('origin')
    try {
      await sg.raw(['rebase', `origin/${defaultBranch}`])
      return true
    } catch {
      await sg.raw(['rebase', '--abort']).catch(() => undefined)
      return false
    }
  } catch {
    return false
  }
}

async function pushWorktreeToDefaultBranch(worktreePath: string, defaultBranch: string) {
  const probe = getSharedProbe()
  probe.invalidate(worktreePath)
  const snapshot = await probe.snapshot(worktreePath, defaultBranch, { force: true })
  return pushOp.execute(
    { workspacePath: worktreePath, snapshot },
    { source: 'HEAD', branch: defaultBranch, setUpstream: false, forceWithLease: false }
  )
}

// push HEAD:<defaultBranch>；NON_FAST_FORWARD → rebase origin/<defaultBranch> → 重 push。
// 永不 force（共享 main，强推会覆盖他人提交）。冲突则保留 worktree 交 AI。
async function pushWithRetry(worktreePath: string, defaultBranch: string): Promise<
  | { ok: true }
  | { ok: false; conflict: true; conflictFiles: string[] }
  | { ok: false; conflict: false; code: 'AUTH' | 'NETWORK' | 'OTHER'; message: string }
> {
  const sg = gitFor(worktreePath)
  const first = await pushWorktreeToDefaultBranch(worktreePath, defaultBranch)
  if (first.ok) return { ok: true }
  if (first.failure.kind !== 'NON_FAST_FORWARD') {
    return { ok: false, conflict: false, code: nonConflictCode(first.failure), message: msgOf(first.failure) }
  }
  try {
    await sg.raw(['rebase', `origin/${defaultBranch}`])
  } catch (e) {
    const f = classifyError(e, { during: 'rebase' })
    if (f.kind === 'CONFLICT') {
      const files = await conflictFilesIn(worktreePath)
      return { ok: false, conflict: true, conflictFiles: files.length > 0 ? files : f.files }
    }
    return { ok: false, conflict: false, code: nonConflictCode(f), message: msgOf(f) }
  }
  const second = await pushWorktreeToDefaultBranch(worktreePath, defaultBranch)
  if (second.ok) return { ok: true }
  return { ok: false, conflict: false, code: nonConflictCode(second.failure), message: msgOf(second.failure) }
}

async function conflictFilesIn(worktreePath: string): Promise<string[]> {
  try {
    const out = await gitFor(worktreePath).raw(['diff', '--name-only', '--diff-filter=U'])
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

export async function pushToTeamSpace(
  workspaceId: string,
  target: TeamPushTarget,
  opts: TeamPushOptions = {}
): Promise<TeamPushOutcome> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const workspacePath = ws.path
  const defaultBranch = ws.defaultBranch || 'main'
  const emit = (phase: TeamPushPhase, ok: boolean, message?: string): void => {
    opts.onProgress?.({ workspaceId, phase, ok, message })
  }

  // 无远端 → 没有「团队空间」可推
  const remoteOut = await gitFor(workspacePath).raw(['remote']).catch(() => '')
  if (!remoteOut.trim()) {
    return { ok: false, phase: 'fetch', code: 'NO_REMOTE', message: '当前项目没有远端仓库，无法推送到团队空间' }
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '').slice(0, 14) + '-' + randomBytes(3).toString('hex')
  const worktreePath = teamPushWorktreeDir(workspaceId, runId)

  // 1. fetch（共享 .git，workspacePath 跑即可）
  emit('fetch', true)
  try {
    await gitForWithAskpass(workspacePath).then((sg) => sg.fetch('origin'))
  } catch (e) {
    const f = classifyError(e, { during: 'fetch' })
    return { ok: false, phase: 'fetch', code: codeOf(f), message: msgOf(f), worktreePath }
  }

  // 2. worktree add --detach origin/<defaultBranch>（基于远端主线，避免动本地 main）
  emit('add-worktree', true)
  try {
    await addWorktree({
      repoPath: workspacePath,
      targetPath: worktreePath,
      detach: true,
      from: `origin/${defaultBranch}`
    })
  } catch (e) {
    await removeWorktree(workspacePath, worktreePath)
    const f = classifyError(e)
    return { ok: false, phase: 'add-worktree', code: codeOf(f), message: msgOf(f), worktreePath }
  }

  // 3. 镜像 <relPath>
  emit('mirror', true)
  try {
    await mirrorDir(join(workspacePath, target.relPath), join(worktreePath, target.relPath))
  } catch (e) {
    await removeWorktree(workspacePath, worktreePath)
    return { ok: false, phase: 'mirror', code: 'OTHER', message: `镜像文件失败：${errMsg(e)}`, worktreePath }
  }

  const wt = gitFor(worktreePath)

  // 4. stage
  emit('stage', true)
  try {
    await wt.add(['-A', target.relPath])
  } catch (e) {
    await removeWorktree(workspacePath, worktreePath)
    return { ok: false, phase: 'stage', code: 'OTHER', message: `暂存失败：${errMsg(e)}`, worktreePath }
  }

  // 5. 空 → 团队空间已一致，无需推送
  const status = await wt.status().catch(() => null)
  if (status?.isClean()) {
    await removeWorktree(workspacePath, worktreePath)
    emit('done', true, '团队空间内容与你一致，无需推送')
    return { ok: true, pushed: false, empty: true }
  }

  emit('commit', true)
  try {
    await wt.commit(commitMessage(target))
  } catch (e) {
    await removeWorktree(workspacePath, worktreePath)
    return { ok: false, phase: 'commit', code: 'OTHER', message: `提交失败：${errMsg(e)}`, worktreePath }
  }

  // 6. push（含 NON_FAST_FORWARD rebase 重试）；冲突保留 worktree 交 AI
  emit('push', true)
  const pushResult = await pushWithRetry(worktreePath, defaultBranch)
  if (pushResult.ok) {
    await removeWorktree(workspacePath, worktreePath)
    // reconcile 分支到 origin/main 消除「有更新」误报（停留当前分支）
    emit('reconcile', true)
    await reconcileAfterPush(workspacePath, defaultBranch)
    emit('done', true)
    return { ok: true, pushed: true, empty: false }
  }
  if (pushResult.conflict) {
    // 保留 worktree：AI 提示词会指到此目录解冲突
    return {
      ok: false,
      phase: 'push',
      code: 'CONFLICT',
      message: '与团队空间冲突，需在临时目录解决',
      worktreePath,
      conflictFiles: pushResult.conflictFiles
    }
  }
  await removeWorktree(workspacePath, worktreePath)
  return { ok: false, phase: 'push', code: pushResult.code, message: pushResult.message, worktreePath }
}
