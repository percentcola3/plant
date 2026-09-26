import { BrowserWindow } from 'electron'
import { gitFor, gitForBackground } from './client'
import { getSharedProbe } from './probe'
import { getActiveWorkspaceId, getWorkspace } from '../workspaces/service'

// 后台定时对当前活跃工作区跑一次 `git fetch --prune`，只刷新 remote-tracking
// ref（origin/<branch>），不 merge、不动工作树。目的：让侧边栏「同步角标」
// 的 behind 计数像 VSCode 一样保持新鲜，不必靠用户手动打开编辑器触发 fetch。
//
// 复用 gitForBackground（cache-only askpass）：凭证命中才真正联网，未命中
// 静默 abort，永不弹 PAT 框。fetch 成功后 invalidate probe 的 2s TTL 缓存，
// 并广播 git.remote-updated:<id>，触发 renderer 重拉 git.status。
//
// 结构镜像 external-pool/service.ts 的 startAutoRefresh / stopAutoRefresh。

const FETCH_INTERVAL_MS = 5 * 60 * 1000   // 5 分钟
const INITIAL_DELAY_MS = 10_000           // 启动 10s 后首跑，让 App 先稳定

let initialTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null
let inFlight = false

function broadcastRemoteUpdated(workspaceId: string): void {
  const channel = `git.remote-updated:${workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, { workspaceId })
  }
}

// 仅读 .git/config 是否配了 remote，不联网。与 probe.ts detectRemoteState 的
// hasRemote 判定同源，避免 fetch 一个无 remote 的仓库报错。
async function hasRemote(workspacePath: string): Promise<boolean> {
  try {
    const sg = gitFor(workspacePath)
    const out = await sg.raw(['remote'])
    return out.trim().length > 0
  } catch {
    return false
  }
}

async function runOnce(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const id = await getActiveWorkspaceId()
    if (!id) return
    const ws = await getWorkspace(id)
    if (!ws) return
    if (!(await hasRemote(ws.path))) return

    const sg = await gitForBackground(ws.path)
    await sg.fetch(['--all', '--prune'])

    // fetch 只动 .git/refs/remotes/origin/*（chokidar 忽略 .git/），不会触发
    // 任何现有 push channel；主动 invalidate + 广播，让 renderer 重拉快照。
    getSharedProbe().invalidate(ws.path)
    broadcastRemoteUpdated(id)
  } catch (e) {
    // 凭证缺失 / 网络问题 / 仓库异常一律静默，后台任务不应打扰用户。
    console.warn('[git] background fetch failed:', (e as Error).message)
  } finally {
    inFlight = false
  }
}

export function startBackgroundFetch(options?: {
  initialDelayMs?: number
  intervalMs?: number
}): void {
  if (initialTimer || intervalTimer) return
  const initialDelayMs = options?.initialDelayMs ?? INITIAL_DELAY_MS
  const intervalMs = options?.intervalMs ?? FETCH_INTERVAL_MS

  initialTimer = setTimeout(() => {
    initialTimer = null
    void runOnce()
  }, initialDelayMs)
  intervalTimer = setInterval(() => { void runOnce() }, intervalMs)
}

export function stopBackgroundFetch(): void {
  if (initialTimer) {
    clearTimeout(initialTimer)
    initialTimer = null
  }
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  inFlight = false
}
