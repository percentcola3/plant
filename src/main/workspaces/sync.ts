import { promises as fs } from 'node:fs'
import type { Workspace } from '@shared/types'
import { isAppManagedPath } from '@shared/app-managed-paths'
import { WorkspacesStore } from './store'
import { gitForWithAskpass } from '../git/client'
import { getSharedProbe } from '../git/probe'
import { pushOp } from '../git/ops'
import { dispatchSaga } from '../saga/service'
import type { SagaJournal, SagaStep } from '../saga/types'
import type { GitFailure } from '../git/failures'
import { UIClientError } from '../ipc/errors'

const store = new WorkspacesStore()

// 同步组合操作的步骤事件。renderer 通过 sync.progress:<workspaceId> 订阅。
export type SyncPhase =
  | 'check-clean'
  | 'commit'
  | 'fetch'
  | 'pull-rebase'
  | 'rebase-mainline'
  | 'push'
  | 'done'

export type SyncProgressEvent = {
  workspaceId: string
  phase: SyncPhase
  ok: boolean
  message?: string
}

export type SyncOutcome =
  | { ok: true; pushed: boolean }
  | { ok: false; phase: SyncPhase; code: 'CONFLICT' | 'AUTH' | 'NETWORK' | 'OTHER'; message: string }

export type SyncMode = 'remote' | 'mainline' | 'full'

export type SaveOutcome =
  | { ok: true; pushed: boolean; branch: string; committed: boolean }
  | { ok: false; phase: 'check-clean' | 'commit' | 'push'; code: 'CONFLICT' | 'AUTH' | 'NETWORK' | 'OTHER'; message: string }

export type SyncOptions = {
  mode?: SyncMode
  // 未提交改动如何处理：'commit' = 自动以 message 提交；'reject' = 报 UNCOMMITTED 让上层弹保存对话框
  uncommittedStrategy?: 'commit' | 'reject'
  commitMessage?: string             // uncommittedStrategy='commit' 时使用
  onProgress?: (e: SyncProgressEvent) => void
}

type SyncErrorCode = 'CONFLICT' | 'AUTH' | 'NETWORK' | 'OTHER'

function classify(e: unknown): { code: SyncErrorCode; message: string } {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (lower.includes('conflict') || lower.includes('unmerged paths')) return { code: 'CONFLICT', message: msg }
  if (lower.includes('authentication') || lower.includes('could not read username') || lower.includes('403')) return { code: 'AUTH', message: msg }
  if (lower.includes('could not resolve host') || lower.includes('connect') || lower.includes('timed out')) return { code: 'NETWORK', message: msg }
  return { code: 'OTHER', message: msg }
}

function businessChangedPaths(status: { files?: Array<{ path: string }> }): string[] {
  return (status.files ?? [])
    .map((file) => file.path)
    .filter((path) => !isAppManagedPath(path))
}

async function commitBusinessChanges(
  sg: Awaited<ReturnType<typeof gitForWithAskpass>>,
  message: string | undefined
): Promise<boolean> {
  const status = await sg.status()
  if (status.isClean()) return false

  const changedPaths = businessChangedPaths(status)
  if (changedPaths.length === 0) return false
  const trimmed = message?.trim()
  if (!trimmed) throw new UIClientError('VALIDATION', '保存版本时必须提供说明')

  await sg.add(changedPaths)
  await sg.commit(trimmed)
  return true
}

async function getProjectWs(id: string): Promise<Workspace> {
  const ws = await store.findById(id)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${id}`)
  if (ws.kind !== 'project' && ws.kind !== 'ux' && ws.kind !== 'asset' && ws.kind !== 'knowledge') {
    throw new UIClientError('VALIDATION', '未知工作区类型')
  }
  return ws
}

function stepOpToPhase(op: string): SyncPhase {
  if (op === 'commit') return 'commit'
  if (op === 'fetch') return 'fetch'
  if (op === 'pull-rebase') return 'pull-rebase'
  if (op === 'rebase-onto') return 'rebase-mainline'
  if (op === 'push') return 'push'
  return 'done'
}

function failureToCode(f: GitFailure): SyncErrorCode {
  if (f.kind === 'CONFLICT') return 'CONFLICT'
  if (f.kind === 'AUTH') return 'AUTH'
  if (f.kind === 'NETWORK') return 'NETWORK'
  return 'OTHER'
}

function failureMessage(f: GitFailure): string {
  if (f.kind === 'UNKNOWN') return f.raw
  if (f.kind === 'NETWORK') return f.detail
  if (f.kind === 'CONFLICT') return `合并冲突：${f.files.join(', ') || '未指明文件'}`
  if (f.kind === 'UNCOMMITTED') return `未提交改动：${f.files.join(', ') || '未指明文件'}`
  return f.kind
}

export async function syncWorkspace(workspaceId: string, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const ws = await getProjectWs(workspaceId)
  const mode = opts.mode ?? 'full'
  const emit = (phase: SyncPhase, ok: boolean, message?: string): void => {
    opts.onProgress?.({ workspaceId, phase, ok, message })
  }

  emit('check-clean', true)
  // dirty + reject → 立即返回；不进 saga，phase='check-clean' 保持旧契约
  const pre = await getSharedProbe().snapshot(ws.path, ws.defaultBranch, { force: true })
  if (pre.working.kind === 'dirty' && opts.uncommittedStrategy !== 'commit') {
    const message = '当前工作区有未保存改动；先保存版本再同步'
    emit('check-clean', false, message)
    return { ok: false, phase: 'check-clean', code: 'OTHER', message }
  }

  const journal: SagaJournal = await dispatchSaga({
    intent: 'sync',
    workspaceId,
    workspacePath: ws.path,
    defaultBranch: ws.defaultBranch,
    args: {
      mode,
      uncommittedStrategy: opts.uncommittedStrategy ?? 'reject',
      commitMessage: opts.commitMessage
    },
    trigger: 'user',
    onStepFinish: (_j: SagaJournal, step: SagaStep) => {
      if (step.status === 'failed' && step.failure) {
        emit(stepOpToPhase(step.op), false, failureMessage(step.failure))
      } else {
        emit(stepOpToPhase(step.op), true)
      }
    }
  })

  if (journal.status === 'done') {
    const pushStep = journal.steps.find((s) => s.op === 'push')
    const remoteIsNone = pre.remote.kind === 'no-remote'
    const pushed = !remoteIsNone && pushStep?.status === 'done'
    emit('done', true)
    return { ok: true, pushed }
  }

  const failed = journal.steps[journal.currentStep]
  if (!failed?.failure) {
    return { ok: false, phase: 'fetch', code: 'OTHER', message: '同步未完成' }
  }
  return {
    ok: false,
    phase: stepOpToPhase(failed.op),
    code: failureToCode(failed.failure),
    message: failureMessage(failed.failure)
  }
}

export async function saveWorkspace(workspaceId: string, commitMessage?: string): Promise<SaveOutcome> {
  const ws = await getProjectWs(workspaceId)
  const sg = await gitForWithAskpass(ws.path)
  const status = await sg.status()
  const currentBranch = status.current ?? ws.defaultBranch
  let committed = false

  try {
    committed = await commitBusinessChanges(sg, commitMessage)
  } catch (e) {
    const c = classify(e)
    return { ok: false, phase: 'commit', code: c.code, message: c.message }
  }

  const probe = getSharedProbe()
  probe.invalidate(ws.path)
  const snap = await probe.snapshot(ws.path, ws.defaultBranch, { force: true })
  if (snap.remote.kind === 'no-remote') {
    return { ok: true, pushed: false, branch: currentBranch, committed }
  }
  const pushed = await pushOp.execute({ workspacePath: ws.path, snapshot: snap }, { branch: currentBranch })
  probe.invalidate(ws.path)
  if (!pushed.ok) {
    return { ok: false, phase: 'push', code: failureToCode(pushed.failure), message: failureMessage(pushed.failure) }
  }
  return { ok: true, pushed: true, branch: currentBranch, committed }
}

// 内部用的 fs 触摸函数（让 .knowledge 等空目录有 .gitkeep 时不被误删）
export async function _ensureFile(path: string): Promise<void> {
  await fs.mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true }).catch(() => undefined)
  await fs.writeFile(path, '').catch(() => undefined)
}
