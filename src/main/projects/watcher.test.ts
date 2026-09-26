import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chokidarMock = vi.hoisted(() => ({ watch: vi.fn() }))
const electronMock = vi.hoisted(() => ({ send: vi.fn() }))
const diagnosticsMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))
const spawnHealthMock = vi.hoisted(() => ({ countOpenFds: vi.fn() }))

vi.mock('chokidar', () => ({ default: chokidarMock }))
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: electronMock.send } }]
  }
}))
vi.mock('../diagnostics/runtime', () => ({ diagnostics: diagnosticsMock }))
vi.mock('../system/spawn-health', () => spawnHealthMock)

import { ProjectWatcher } from './watcher'

type EventHandler = (...args: unknown[]) => void
type MockWatcher = {
  on: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
}

const createdWatchers: MockWatcher[] = []

function createMockWatcher(
  close: ReturnType<typeof vi.fn> = vi.fn(async () => undefined)
): MockWatcher {
  const handlers = new Map<string, EventHandler[]>()
  const watcher: MockWatcher = {
    close,
    on: vi.fn((event: string, handler: EventHandler) => {
      const eventHandlers = handlers.get(event) ?? []
      eventHandlers.push(handler)
      handlers.set(event, eventHandlers)
      return watcher
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    }
  }
  return watcher
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('ProjectWatcher', () => {
  let subject: ProjectWatcher

  beforeEach(() => {
    createdWatchers.length = 0
    chokidarMock.watch.mockReset().mockImplementation(() => {
      const watcher = createMockWatcher()
      createdWatchers.push(watcher)
      return watcher
    })
    electronMock.send.mockReset()
    diagnosticsMock.info.mockReset()
    diagnosticsMock.warn.mockReset()
    diagnosticsMock.error.mockReset()
    spawnHealthMock.countOpenFds.mockReset().mockReturnValue(20)
    subject = new ProjectWatcher()
  })

  afterEach(async () => {
    await subject.stopAll()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps one active watcher and treats the same absolute scope as idempotent', async () => {
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    await subject.activate('workspace-a', '/repo', './projects/demo')

    expect(chokidarMock.watch).toHaveBeenCalledTimes(1)
    expect(createdWatchers[0].close).not.toHaveBeenCalled()
    expect(chokidarMock.watch).toHaveBeenCalledWith(
      '/repo/projects/demo',
      expect.objectContaining({
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 30 }
      })
    )
  })

  it('awaits the old watcher close before activating a different scope', async () => {
    const closing = deferred()
    const firstWatcher = createMockWatcher(vi.fn(() => closing.promise))
    chokidarMock.watch.mockImplementationOnce(() => {
      createdWatchers.push(firstWatcher)
      return firstWatcher
    })

    await subject.activate('workspace-a', '/repo-a', 'project-a')
    const switching = subject.activate('workspace-b', '/repo-b', 'project-b')
    await Promise.resolve()
    await Promise.resolve()

    expect(firstWatcher.close).toHaveBeenCalledTimes(1)
    expect(chokidarMock.watch).toHaveBeenCalledTimes(1)

    closing.resolve()
    await switching
    expect(chokidarMock.watch).toHaveBeenCalledTimes(2)
    expect(chokidarMock.watch.mock.calls[1][0]).toBe('/repo-b/project-b')
  })

  it('retains a watcher whose close rejects so a later switch can retry it', async () => {
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce(undefined)
    const firstWatcher = createMockWatcher(close)
    chokidarMock.watch.mockImplementationOnce(() => {
      createdWatchers.push(firstWatcher)
      return firstWatcher
    })

    await subject.activate('workspace-a', '/repo-a', 'project-a')
    await expect(
      subject.activate('workspace-b', '/repo-b', 'project-b')
    ).rejects.toThrow('close failed')

    expect(close).toHaveBeenCalledOnce()
    expect(chokidarMock.watch).toHaveBeenCalledOnce()

    await subject.activate('workspace-b', '/repo-b', 'project-b')
    expect(close).toHaveBeenCalledTimes(2)
    expect(chokidarMock.watch).toHaveBeenCalledTimes(2)
    expect(diagnosticsMock.error).toHaveBeenCalledWith(
      'app.project_watcher.close_failed',
      expect.any(Error),
      { phase: 'project-watcher', reason: 'close-failed' }
    )
  })

  it('delays activation until a spawn lease is released', async () => {
    const lease = await subject.acquireSpawnLease()
    expect(lease).not.toBeNull()

    const activating = subject.activate('workspace-a', '/repo', 'projects/demo')
    await Promise.resolve()
    await Promise.resolve()
    expect(chokidarMock.watch).not.toHaveBeenCalled()

    lease!.release()
    await activating
    expect(chokidarMock.watch).toHaveBeenCalledOnce()
  })

  it.each([
    ['', 'project'],
    ['/repo', ''],
    ['/repo', '   '],
    ['/repo', '.'],
    ['/repo', './'],
    ['/repo', '/absolute'],
    ['/repo', 'C:\\absolute'],
    ['/repo', '../outside'],
    ['/repo', 'child/../outside']
  ])('rejects unsafe scope workspace=%j project=%j', async (workspacePath, projectRelPath) => {
    await expect(
      subject.activate('workspace-a', workspacePath, projectRelPath)
    ).rejects.toThrow()
    expect(chokidarMock.watch).not.toHaveBeenCalled()
  })

  it('emits project changes relative to the workspace path', async () => {
    const listener = vi.fn()
    subject.onChange('workspace-a', listener)
    await subject.activate('workspace-a', '/repo', 'projects/demo')

    createdWatchers[0].emit('add', '/repo/projects/demo/src/index.ts')
    createdWatchers[0].emit('change', '/outside/index.ts')

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
      kind: 'add',
      relPath: 'projects/demo/src/index.ts'
    })
    expect(electronMock.send).toHaveBeenCalledOnce()
    expect(electronMock.send).toHaveBeenCalledWith(
      'fs.change:workspace-a',
      { kind: 'add', relPath: 'projects/demo/src/index.ts' }
    )
  })

  it('records pathless started and ready diagnostics with FD counts', async () => {
    spawnHealthMock.countOpenFds.mockReturnValueOnce(30).mockReturnValueOnce(35)
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    createdWatchers[0].emit('ready')

    expect(diagnosticsMock.info).toHaveBeenCalledWith(
      'app.project_watcher.started',
      {
        phase: 'project-watcher',
        fdBaselineCount: 30,
        fdCount: 30,
        fdDeltaFromBaseline: 0
      }
    )
    expect(diagnosticsMock.info).toHaveBeenCalledWith(
      'app.project_watcher.ready',
      {
        phase: 'project-watcher',
        fdBaselineCount: 30,
        fdCount: 35,
        fdDeltaFromBaseline: 5
      }
    )
    expect(JSON.stringify(diagnosticsMock.info.mock.calls)).not.toContain('/repo')
  })

  it('clears the FD timer when stopped', async () => {
    vi.useFakeTimers()
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    expect(vi.getTimerCount()).toBe(1)

    await subject.stop('workspace-a')
    expect(createdWatchers[0].close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(spawnHealthMock.countOpenFds).toHaveBeenCalledOnce()
  })

  it('closes and broadcasts degraded status once at the FD hard limit', async () => {
    vi.useFakeTimers()
    spawnHealthMock.countOpenFds.mockReturnValueOnce(20).mockReturnValue(2_048)
    await subject.activate('workspace-a', '/repo', 'projects/demo')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(createdWatchers[0].close).toHaveBeenCalledOnce()
    expect(diagnosticsMock.error).toHaveBeenCalledOnce()
    expect(electronMock.send).toHaveBeenCalledOnce()
    expect(electronMock.send).toHaveBeenCalledWith(
      'fs.watch-status:workspace-a',
      { state: 'degraded', reason: 'resource-limit' }
    )
  })

  it('closes and broadcasts degraded status once on watcher error', async () => {
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    createdWatchers[0].emit('error', new Error('watch failed'))
    createdWatchers[0].emit('error', new Error('watch failed again'))
    await Promise.resolve()
    await Promise.resolve()

    expect(createdWatchers[0].close).toHaveBeenCalledOnce()
    expect(diagnosticsMock.error).toHaveBeenCalledOnce()
    expect(electronMock.send).toHaveBeenCalledOnce()
    expect(electronMock.send).toHaveBeenCalledWith(
      'fs.watch-status:workspace-a',
      { state: 'degraded', reason: 'watch-error' }
    )
  })

  it('warns only once after crossing the FD soft delta', async () => {
    vi.useFakeTimers()
    spawnHealthMock.countOpenFds.mockReturnValueOnce(20).mockReturnValue(148)
    await subject.activate('workspace-a', '/repo', 'projects/demo')

    await vi.advanceTimersByTimeAsync(1_500)

    expect(diagnosticsMock.warn).toHaveBeenCalledOnce()
    expect(createdWatchers[0].close).not.toHaveBeenCalled()
  })

  it('keeps spawn available when FD scanning is unavailable', async () => {
    spawnHealthMock.countOpenFds.mockReturnValue(-1)

    await expect(subject.ensureSpawnHeadroom()).resolves.toBe(true)
    expect(diagnosticsMock.warn).toHaveBeenCalledWith(
      'app.project_watcher.spawn_headroom_scan_unavailable',
      expect.objectContaining({ reason: 'fd-scan-unavailable', fdCount: -1 })
    )
    expect(chokidarMock.watch).not.toHaveBeenCalled()
  })

  it('closes the watcher and rechecks FD headroom before allowing spawn', async () => {
    vi.useFakeTimers()
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    spawnHealthMock.countOpenFds.mockReset()
      .mockReturnValueOnce(2_048)
      .mockReturnValueOnce(100)

    const checking = subject.ensureSpawnHeadroom()
    await vi.advanceTimersByTimeAsync(50)

    await expect(checking).resolves.toBe(true)
    expect(createdWatchers[0].close).toHaveBeenCalledOnce()
    expect(diagnosticsMock.info).toHaveBeenCalledWith(
      'app.project_watcher.spawn_headroom_recovered',
      expect.objectContaining({ fdBaselineCount: 2_048, fdCount: 100 })
    )
    expect(electronMock.send).toHaveBeenCalledWith(
      'fs.watch-status:workspace-a',
      { state: 'degraded', reason: 'resource-limit' }
    )
  })

  it('allows a post-degradation activation after the spawn lease is released', async () => {
    vi.useFakeTimers()
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    spawnHealthMock.countOpenFds.mockReset()
      .mockReturnValueOnce(2_048)
      .mockReturnValue(100)

    const acquiring = subject.acquireSpawnLease()
    await vi.advanceTimersByTimeAsync(50)
    const lease = await acquiring
    const activating = subject.activate('workspace-b', '/repo', 'projects/other')

    expect(lease).not.toBeNull()
    expect(createdWatchers).toHaveLength(1)
    expect(createdWatchers[0].close).toHaveBeenCalledOnce()

    lease!.release()
    await activating
    expect(createdWatchers).toHaveLength(2)
  })

  it('drops a pre-fuse activation queued behind a lease but accepts a later activation', async () => {
    vi.useFakeTimers()
    spawnHealthMock.countOpenFds.mockReturnValue(20)
    await subject.activate('workspace-a', '/repo', 'projects/first')
    const lease = await subject.acquireSpawnLease()
    expect(lease).not.toBeNull()

    const staleActivation = subject.activate('workspace-b', '/repo', 'projects/stale')
    await Promise.resolve()
    expect(createdWatchers).toHaveLength(1)

    spawnHealthMock.countOpenFds.mockReturnValue(2_048)
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    expect(createdWatchers[0].close).toHaveBeenCalledOnce()

    lease!.release()
    await staleActivation
    expect(createdWatchers).toHaveLength(1)

    spawnHealthMock.countOpenFds.mockReturnValue(20)
    await subject.activate('workspace-c', '/repo', 'projects/fresh')
    expect(createdWatchers).toHaveLength(2)
    expect(chokidarMock.watch.mock.calls[1][0]).toBe('/repo/projects/fresh')
  })

  it.each(['stop', 'stopAll'] as const)(
    '%s invalidates an activation already queued behind a spawn lease',
    async (operation) => {
      const lease = await subject.acquireSpawnLease()
      expect(lease).not.toBeNull()

      const staleActivation = subject.activate('workspace-a', '/repo', 'projects/stale')
      if (operation === 'stop') await subject.stop('workspace-not-active')
      else await subject.stopAll()

      lease!.release()
      await staleActivation
      expect(chokidarMock.watch).not.toHaveBeenCalled()

      await subject.activate('workspace-b', '/repo', 'projects/fresh')
      expect(chokidarMock.watch).toHaveBeenCalledOnce()
      expect(chokidarMock.watch.mock.calls[0][0]).toBe('/repo/projects/fresh')
    }
  )

  it('blocks spawn when FD headroom remains exhausted after watcher close', async () => {
    vi.useFakeTimers()
    await subject.activate('workspace-a', '/repo', 'projects/demo')
    spawnHealthMock.countOpenFds.mockReset().mockReturnValue(2_048)

    const checking = subject.ensureSpawnHeadroom()
    await vi.advanceTimersByTimeAsync(50)

    await expect(checking).resolves.toBe(false)
    expect(createdWatchers[0].close).toHaveBeenCalledOnce()
    expect(diagnosticsMock.error).toHaveBeenCalledWith(
      'app.project_watcher.spawn_headroom_unavailable',
      expect.any(Error),
      expect.objectContaining({ reason: 'hard-fd-limit', fdCount: 2_048 })
    )
  })
})
