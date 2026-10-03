import { BrowserWindow } from 'electron'
import { WorkspacesStore } from '../workspaces/store'
import { projectWatcher } from '../projects/watcher'
import { dispatchSaga } from './service'
import { readGitCapability } from '../git/capability'
import { getSharedProbe } from '../git/probe'

// fs change → debounce → remote sync（commit + fetch + pull-rebase + push）
// 本地 Git 目录只 commit；未绑定目录不执行 Git 操作。
// before-quit → 只 commit，push 留给下次启动 resume

const DEBOUNCE_MS = 5_000

const timers = new Map<string, NodeJS.Timeout>()
const subs = new Map<string, () => void>()
const store = new WorkspacesStore()
export type AutoSyncStatus = { state: 'idle' | 'syncing' | 'error'; message?: string; lastSyncedAt?: string }
const statuses = new Map<string, AutoSyncStatus>()
export function readAutoSyncStatus(workspaceId: string): AutoSyncStatus {
  return statuses.get(workspaceId) ?? { state: 'idle' }
}
export function setAutoSyncStatus(workspaceId: string, status: AutoSyncStatus): void {
  statuses.set(workspaceId, status)
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(`git.auto-sync-status:${workspaceId}`, status)
}

export function bindAutoSave(workspaceId: string): void {
  if (subs.has(workspaceId)) return
  const dispose = projectWatcher.onChange(workspaceId, () => scheduleSave(workspaceId))
  subs.set(workspaceId, dispose)
}

export function unbindAutoSave(workspaceId: string): void {
  subs.get(workspaceId)?.()
  subs.delete(workspaceId)
  const t = timers.get(workspaceId)
  if (t) { clearTimeout(t); timers.delete(workspaceId) }
}

export function unbindAll(): void {
  for (const id of [...subs.keys()]) unbindAutoSave(id)
}

function scheduleSave(workspaceId: string): void {
  const old = timers.get(workspaceId)
  if (old) clearTimeout(old)
  const handle = setTimeout(() => {
    timers.delete(workspaceId)
    void runSave(workspaceId, true).catch(() => undefined)
  }, DEBOUNCE_MS)
  timers.set(workspaceId, handle)
}

async function runSave(workspaceId: string, pushAfter: boolean, trigger: 'fs-change' | 'before-quit' | 'focus' = pushAfter ? 'fs-change' : 'before-quit', strategy: 'commit' | 'reject' = 'commit'): Promise<void> {
  const ws = await store.findById(workspaceId)
  if (!ws) return
  const capability = await readGitCapability(ws.path)
  if (capability.state === 'unbound') return
  const syncRemote = pushAfter && capability.state === 'remote'
  setAutoSyncStatus(workspaceId, { state: 'syncing', lastSyncedAt: readAutoSyncStatus(workspaceId).lastSyncedAt })
  let journal
  try {
    journal = await dispatchSaga({
      intent: syncRemote ? 'sync' : 'save',
      workspaceId,
      workspacePath: ws.path,
      defaultBranch: ws.defaultBranch,
      args: syncRemote
        ? { mode: 'remote', uncommittedStrategy: strategy }
        : { release: false, pushAfter: false },
      trigger
    })
  } catch (error) {
    setAutoSyncStatus(workspaceId, { state: 'error', message: error instanceof Error ? error.message : String(error) })
    throw error
  }
  setAutoSyncStatus(workspaceId, journal.status === 'done'
    ? { state: 'idle', lastSyncedAt: new Date().toISOString() }
    : { state: 'error', message: '自动同步未完成，请使用手动同步处理' })

  // fs-change 路径 push 成功后通知渲染端弹"已推送 wip"toast。
  // 用户对"未察觉的自动 push"是有感知诉求的，可见提示让他们能及时撤回。
  if (pushAfter && journal.status === 'done') {
    const pushed = journal.steps.some((s) => s.op === 'push' && s.status === 'done')
    if (pushed) {
      const commitStep = journal.steps.find((s) => s.op === 'commit' && s.status === 'done')
      const message = typeof commitStep?.args.message === 'string' ? commitStep.args.message : ''
      const branch = journal.snapshotAfter?.branch ?? journal.snapshotBefore?.branch ?? ws.defaultBranch
      broadcastFsChangePushed(workspaceId, { branch, message })
    }
  }
}

function broadcastFsChangePushed(workspaceId: string, payload: { branch: string; message: string }): void {
  const channel = `saga.fs-change-pushed:${workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

// before-quit 调用：取消挂起 debouncer + 对当前激活工作区跑一次 commit-only。
// 设计取舍："关闭时只 commit、push 完全异步"——saga journal 留待下次启动 resume 把 push 跑掉。
export async function flushBeforeQuit(): Promise<void> {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  const activeId = await store.activeId().catch(() => null)
  if (activeId) await runSave(activeId, false).catch(() => undefined)
}

// 工作区激活/切换时调：同步远端，并补推关闭时留下的本地提交。
// 把上次因为：
//   - push 失败被 paused-for-user（runner 不自动重试）
//   - before-quit 只 commit 没 push（resumeAll 不会 resume paused 类型）
//   - 用户长时间不改文件而保留的本地领先 commit
// 这些场景留下的 ↑N 一并推走。
//
// commit 步骤在 clean 时 isSatisfied → 跳过；push 步骤在没领先时 isSatisfied → 跳过。
// 所以正常情况下基本是 no-op，开销可忽略。
export async function catchUpPush(workspaceId: string): Promise<void> {
  await runSave(workspaceId, true, 'focus').catch(() => undefined)
}

// 后台 fetch 发现新提交时，只在干净工作树上同步；冲突保留给手动同步处理。
export async function syncIncomingChanges(workspaceId: string): Promise<void> {
  if (await store.activeId() !== workspaceId || readAutoSyncStatus(workspaceId).state !== 'idle') return
  const ws = await store.findById(workspaceId)
  if (!ws) return
  const snapshot = await getSharedProbe().snapshot(ws.path, ws.defaultBranch, { force: true })
  if (snapshot.working.kind !== 'clean' || snapshot.remote.kind !== 'tracked' || snapshot.remote.incoming === 0) return
  await runSave(workspaceId, true, 'focus', 'reject')
}
