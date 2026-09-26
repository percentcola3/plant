import chokidar, { type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { diagnostics } from '../diagnostics/runtime'
import { countOpenFds } from '../system/spawn-health'

const FD_CHECK_INTERVAL_MS = 500
const FD_RELEASE_WAIT_MS = 50
const FD_SOFT_DELTA = 128
const FD_HARD_DELTA = 512
const FD_HARD_COUNT = 2_048

type Suppress = { until: number }
type ChangeEvent = { kind: 'add' | 'change' | 'unlink'; relPath: string }
type ChangeListener = (event: ChangeEvent) => void
type WatchStatusReason = 'resource-limit' | 'watch-error'

export type SpawnLease = {
  release(): void
}

type ActiveWatcher = {
  workspaceId: string
  workspacePath: string
  scopePath: string
  watcher: FSWatcher
  fdBaselineCount: number
  fdTimer: NodeJS.Timeout | null
  softWarningEmitted: boolean
  readyEmitted: boolean
  faulted: boolean
  closing: boolean
}

type ResolvedScope = Pick<ActiveWatcher, 'workspaceId' | 'workspacePath' | 'scopePath'>

function pathIsOutside(basePath: string, targetPath: string): boolean {
  const relPath = relative(basePath, targetPath)
  return relPath === '..' || relPath.startsWith(`..${sep}`) || isAbsolute(relPath)
}

function resolveProjectScope(
  workspaceId: string,
  workspacePath: string,
  projectRelPath: string
): ResolvedScope {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
    throw new Error('workspacePath must not be empty')
  }
  if (typeof projectRelPath !== 'string' || projectRelPath.trim() === '') {
    throw new Error('projectRelPath must not be empty')
  }

  const trimmedRelPath = projectRelPath.trim()
  if (isAbsolute(trimmedRelPath) || win32.isAbsolute(trimmedRelPath)) {
    throw new Error('projectRelPath must be relative')
  }

  const normalizedRelPath = trimmedRelPath.replace(/\\/g, '/')
  if (normalizedRelPath.split('/').includes('..')) {
    throw new Error('projectRelPath must stay inside the workspace')
  }

  const normalizedWorkspacePath = resolve(workspacePath)
  const scopePath = resolve(normalizedWorkspacePath, normalizedRelPath)
  if (scopePath === normalizedWorkspacePath || pathIsOutside(normalizedWorkspacePath, scopePath)) {
    throw new Error('projectRelPath must stay inside the workspace')
  }

  return {
    workspaceId,
    workspacePath: normalizedWorkspacePath,
    scopePath
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

export class ProjectWatcher {
  private active: ActiveWatcher | null = null
  private suppress = new Map<string, Suppress>()
  private listeners = new Map<string, Set<ChangeListener>>()
  private transition: Promise<void> = Promise.resolve()
  private activationTransition: Promise<void> = Promise.resolve()
  private activationGeneration = 0

  async activate(
    workspaceId: string,
    workspacePath: string,
    projectRelPath: string
  ): Promise<void> {
    const next = resolveProjectScope(workspaceId, workspacePath, projectRelPath)
    const requestedGeneration = this.activationGeneration
    await this.enqueueActivation(() => this.enqueue(async () => {
      if (requestedGeneration !== this.activationGeneration) return
      if (
        this.active?.scopePath === next.scopePath
        && !this.active.faulted
        && !this.active.closing
      ) {
        const previousWorkspaceId = this.active.workspaceId
        this.active.workspaceId = next.workspaceId
        this.active.workspacePath = next.workspacePath
        if (previousWorkspaceId !== next.workspaceId) this.suppress.delete(previousWorkspaceId)
        return
      }

      await this.closeActive()
      this.startActive(next)
    }))
  }

  async stop(workspaceId: string): Promise<void> {
    // App 只有一个 watcher；后到的 stop 意图应淘汰此前所有排队 activation，
    // 即使 workspace 当前尚未 active（它可能正排在 spawn lease 后面）。
    this.invalidatePendingActivations()
    await this.enqueue(async () => {
      if (this.active?.workspaceId === workspaceId) await this.closeActive()
      this.suppress.delete(workspaceId)
    })
  }

  async stopAll(): Promise<void> {
    this.invalidatePendingActivations()
    await this.enqueue(async () => {
      await this.closeActive()
      this.suppress.clear()
    })
  }

  async ensureSpawnHeadroom(): Promise<boolean> {
    const initialFdCount = countOpenFds()
    if (initialFdCount < 0) {
      diagnostics.warn('app.project_watcher.spawn_headroom_scan_unavailable', {
        phase: 'spawn-headroom',
        reason: 'fd-scan-unavailable',
        fdCount: initialFdCount
      })
      return true
    }
    if (initialFdCount < FD_HARD_COUNT) return true

    this.broadcastActiveStatus('resource-limit')
    await this.stopAll()
    await delay(FD_RELEASE_WAIT_MS)

    const fdCount = countOpenFds()
    if (fdCount < 0) {
      diagnostics.warn('app.project_watcher.spawn_headroom_scan_unavailable', {
        phase: 'spawn-headroom',
        reason: 'fd-scan-unavailable',
        fdBaselineCount: initialFdCount,
        fdCount,
        fdDeltaFromBaseline: -1
      })
      return true
    }
    if (fdCount < FD_HARD_COUNT) {
      diagnostics.info('app.project_watcher.spawn_headroom_recovered', {
        phase: 'spawn-headroom',
        reason: 'watcher-closed',
        fdBaselineCount: initialFdCount,
        fdCount,
        fdDeltaFromBaseline: fdCount - initialFdCount
      })
      return true
    }

    diagnostics.error(
      'app.project_watcher.spawn_headroom_unavailable',
      new Error('Insufficient file descriptor headroom for child process spawn'),
      {
        phase: 'spawn-headroom',
        reason: 'hard-fd-limit',
        fdBaselineCount: initialFdCount,
        fdCount,
        fdDeltaFromBaseline: fdCount >= 0 && initialFdCount >= 0
          ? fdCount - initialFdCount
          : -1
      }
    )
    return false
  }

  async acquireSpawnLease(): Promise<SpawnLease | null> {
    return new Promise<SpawnLease | null>((resolveLease, rejectLease) => {
      void this.enqueueActivation(async () => {
        const hasHeadroom = await this.ensureSpawnHeadroom()
        if (!hasHeadroom) {
          resolveLease(null)
          return
        }

        await new Promise<void>((resolveRelease) => {
          let released = false
          resolveLease({
            release: () => {
              if (released) return
              released = true
              resolveRelease()
            }
          })
        })
      }).catch(rejectLease)
    })
  }

  // git 操作前后调用，避免 commit / reset 引发的事件被错误标成“未保存”
  suppressFor(workspaceId: string, ms: number): void {
    this.suppress.set(workspaceId, { until: Date.now() + ms })
  }

  // main-process 订阅入口（saga auto-save 用）；renderer 仍走 broadcast
  onChange(workspaceId: string, callback: ChangeListener): () => void {
    let listeners = this.listeners.get(workspaceId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(workspaceId, listeners)
    }
    listeners.add(callback)
    return () => {
      listeners!.delete(callback)
      if (listeners!.size === 0) this.listeners.delete(workspaceId)
    }
  }

  private enqueue(operation: () => void | Promise<void>): Promise<void> {
    const result = this.transition.then(operation, operation)
    this.transition = result.catch(() => undefined)
    return result
  }

  private enqueueActivation<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.activationTransition.then(operation, operation)
    this.activationTransition = result.then(() => undefined, () => undefined)
    return result
  }

  private startActive(scope: ResolvedScope): void {
    const fdBaselineCount = countOpenFds()
    const watcher = chokidar.watch(scope.scopePath, {
      ignored: [
        /(^|[\\/])\.git([\\/]|$)/,
        /(^|[\\/])\.ui-client([\\/]|$)/,
        /(^|[\\/])\.external([\\/]|$)/,
        /(^|[\\/])\.workspace([\\/]|$)/,
        /(^|[\\/])\.claude[\\/]skills([\\/]|$)/,
        /(^|[\\/])\.agents[\\/]skills([\\/]|$)/,
        /(^|[\\/])AGENTS\.md$/,
        /(^|[\\/])CLAUDE\.md$/,
        /(^|[\\/])node_modules([\\/]|$)/,
        /(^|[\\/])\.DS_Store$/
      ],
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 30 }
    })
    const active: ActiveWatcher = {
      ...scope,
      watcher,
      fdBaselineCount,
      fdTimer: null,
      softWarningEmitted: false,
      readyEmitted: false,
      faulted: false,
      closing: false
    }
    this.active = active

    const onEvent = (kind: ChangeEvent['kind']) => (fullPath: string) => {
      if (this.active !== active || active.faulted || active.closing) return
      const suppression = this.suppress.get(active.workspaceId)
      if (suppression && Date.now() < suppression.until) return

      const absolutePath = isAbsolute(fullPath)
        ? resolve(fullPath)
        : resolve(active.scopePath, fullPath)
      if (
        pathIsOutside(active.scopePath, absolutePath)
        || pathIsOutside(active.workspacePath, absolutePath)
      ) return

      const relPath = relative(active.workspacePath, absolutePath).replace(/\\/g, '/')
      if (!relPath) return
      const event: ChangeEvent = { kind, relPath }
      this.emit(active.workspaceId, event)
      this.broadcastChange(active.workspaceId, event)
    }

    watcher.on('add', onEvent('add'))
    watcher.on('change', onEvent('change'))
    watcher.on('unlink', onEvent('unlink'))
    watcher.on('ready', () => this.handleWatcherReady(active))
    watcher.on('error', (error: unknown) => this.handleWatcherError(active, error))

    diagnostics.info('app.project_watcher.started', {
      phase: 'project-watcher',
      fdBaselineCount,
      fdCount: fdBaselineCount,
      fdDeltaFromBaseline: fdBaselineCount >= 0 ? 0 : -1
    })

    this.startFdTimer(active)
  }

  private async closeActive(): Promise<void> {
    const active = this.active
    if (!active) return
    active.closing = true
    this.clearFdTimer(active)
    try {
      await active.watcher.close()
    } catch (error) {
      active.closing = false
      if (this.active === active && !active.faulted) this.startFdTimer(active)
      diagnostics.error('app.project_watcher.close_failed', error, {
        phase: 'project-watcher',
        reason: 'close-failed'
      })
      throw error
    }
    if (this.active === active) this.active = null
    this.suppress.delete(active.workspaceId)
  }

  private checkFdLimit(active: ActiveWatcher): void {
    if (this.active !== active || active.faulted || active.closing) return
    const fdCount = countOpenFds()
    if (fdCount < 0) return
    const fdDeltaFromBaseline = active.fdBaselineCount >= 0
      ? fdCount - active.fdBaselineCount
      : -1
    const attributes = {
      phase: 'project-watcher',
      fdBaselineCount: active.fdBaselineCount,
      fdCount,
      fdDeltaFromBaseline
    }

    if (fdCount >= FD_HARD_COUNT || fdDeltaFromBaseline >= FD_HARD_DELTA) {
      diagnostics.error(
        'app.project_watcher.fd_hard_limit',
        new Error('Project watcher reached the file descriptor hard limit'),
        { ...attributes, reason: 'hard-fd-limit' }
      )
      this.scheduleFaultClose(active, 'resource-limit')
      return
    }

    if (fdDeltaFromBaseline >= FD_SOFT_DELTA && !active.softWarningEmitted) {
      active.softWarningEmitted = true
      diagnostics.warn('app.project_watcher.fd_soft_limit', {
        ...attributes,
        reason: 'soft-fd-limit'
      })
    }
  }

  private handleWatcherReady(active: ActiveWatcher): void {
    if (this.active !== active || active.faulted || active.closing || active.readyEmitted) return
    active.readyEmitted = true
    const fdCount = countOpenFds()
    diagnostics.info('app.project_watcher.ready', {
      phase: 'project-watcher',
      fdBaselineCount: active.fdBaselineCount,
      fdCount,
      fdDeltaFromBaseline: fdCount >= 0 && active.fdBaselineCount >= 0
        ? fdCount - active.fdBaselineCount
        : -1
    })
  }

  private handleWatcherError(active: ActiveWatcher, error: unknown): void {
    if (this.active !== active || active.faulted || active.closing) return
    const fdCount = countOpenFds()
    diagnostics.error('app.project_watcher.error', error, {
      phase: 'project-watcher',
      reason: 'watch-error',
      fdBaselineCount: active.fdBaselineCount,
      fdCount,
      fdDeltaFromBaseline: fdCount >= 0 && active.fdBaselineCount >= 0
        ? fdCount - active.fdBaselineCount
        : -1
    })
    this.scheduleFaultClose(active, 'watch-error')
  }

  private scheduleFaultClose(active: ActiveWatcher, reason: WatchStatusReason): void {
    if (this.active !== active || active.faulted) return
    this.invalidatePendingActivations()
    active.faulted = true
    this.clearFdTimer(active)
    this.broadcastStatus(active.workspaceId, reason)
    void this.enqueue(async () => {
      if (this.active === active) await this.closeActive()
    }).catch(() => undefined)
  }

  private invalidatePendingActivations(): void {
    this.activationGeneration += 1
  }

  private startFdTimer(active: ActiveWatcher): void {
    if (active.fdTimer) return
    const fdTimer = setInterval(() => this.checkFdLimit(active), FD_CHECK_INTERVAL_MS)
    fdTimer.unref()
    active.fdTimer = fdTimer
  }

  private clearFdTimer(active: ActiveWatcher): void {
    if (!active.fdTimer) return
    clearInterval(active.fdTimer)
    active.fdTimer = null
  }

  private emit(workspaceId: string, event: ChangeEvent): void {
    const listeners = this.listeners.get(workspaceId)
    if (!listeners) return
    for (const callback of listeners) {
      try {
        callback(event)
      } catch {
        // Listener failures must not interrupt file watching.
      }
    }
  }

  private broadcastChange(workspaceId: string, event: ChangeEvent): void {
    this.broadcast(`fs.change:${workspaceId}`, event)
  }

  private broadcastStatus(workspaceId: string, reason: WatchStatusReason): void {
    this.broadcast(`fs.watch-status:${workspaceId}`, { state: 'degraded', reason })
  }

  private broadcastActiveStatus(reason: WatchStatusReason): void {
    const active = this.active
    if (active && !active.closing) this.broadcastStatus(active.workspaceId, reason)
  }

  private broadcast(channel: string, payload: object): void {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        window.webContents.send(channel, payload)
      } catch {
        // A window can disappear while a watcher event is being delivered.
      }
    }
  }
}

export const projectWatcher = new ProjectWatcher()
