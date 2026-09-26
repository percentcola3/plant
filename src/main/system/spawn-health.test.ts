import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../diagnostics/runtime', () => ({
  diagnostics: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

import {
  captureSpawnDiagnostics,
  countOpenFds,
  describeSpawnAccess,
  describeSpawnPath,
  ensureSpawnHealth,
  probeSpawnVariants,
  recordSpawnRelatedEpipe,
  repairMissingStdioFds,
  runSpawnProbe
} from './spawn-health'

describe('spawn-health', () => {
  it('reports a sane fd count', () => {
    expect(countOpenFds()).toBeGreaterThan(0)
  })

  it('captures bounded, path-free fd and process-stream diagnostics', () => {
    const snapshot = captureSpawnDiagnostics()
    const sampledKinds = snapshot.fdFileCount
      + snapshot.fdDirectoryCount
      + snapshot.fdSocketCount
      + snapshot.fdFifoCount
      + snapshot.fdCharacterCount
      + snapshot.fdBlockCount
      + snapshot.fdOtherCount
      + snapshot.fdInvalidCount

    expect(snapshot.fdCount).toBeGreaterThan(0)
    expect(snapshot.fdScanCode).toBe('ok')
    expect(snapshot.fdNext).toBeGreaterThan(2)
    expect(snapshot.fdNextCode).toBe('ok')
    expect(snapshot.fdBaselineCount).toBeGreaterThan(0)
    expect(snapshot.fdHighWater).toBeGreaterThanOrEqual(snapshot.fdCount)
    expect(snapshot.fdSampledCount).toBeLessThanOrEqual(256)
    expect(sampledKinds).toBe(snapshot.fdSampledCount)
    expect(snapshot.stdinFdState).toMatch(/^(valid|invalid):/)
    expect(snapshot.stdoutFdState).toMatch(/^(valid|invalid):/)
    expect(snapshot.stderrFdState).toMatch(/^(valid|invalid):/)
    expect(snapshot.activeResources).not.toContain('/Users/')
    expect(JSON.stringify(snapshot)).not.toContain(process.cwd())
  })

  it('describes spawn paths without returning the path value', () => {
    expect(describeSpawnPath(process.cwd())).toBe('directory')
    expect(describeSpawnPath('claude')).toBe('command-name')
    expect(describeSpawnPath('/definitely-missing-ui-client-path')).toMatch(/^unavailable:/)
  })

  it('checks cwd and executable access without returning path values', () => {
    expect(describeSpawnAccess(process.cwd(), 'cwd')).toBe('ok')
    expect(describeSpawnAccess('/usr/bin/true', 'executable')).toBe('ok')
    expect(describeSpawnAccess('claude', 'executable')).toBe('command-name')
    expect(describeSpawnAccess('/definitely-missing-ui-client-path', 'cwd')).toMatch(/^unavailable:/)
  })

  it('keeps valid stdio fds untouched (no repair needed in a normal process)', () => {
    // 测试进程的 0/1/2 都有效，不应发生重绑
    expect(repairMissingStdioFds()).toEqual([])
  })

  it('spawn probe passes in a healthy process with spawn-turn options', async () => {
    // pipe + detached 与 spawn-turn 完全一致；等待 close 后才判定健康
    expect(await runSpawnProbe()).toBe('ok')
  })

  it('reports a real synchronous EBADF without closing the test process stdio', async () => {
    expect(await runSpawnProbe({
      stdio: [999_999, 'pipe', 'pipe']
    })).toBe('sync:EBADF')
  })

  it('captures errors emitted after spawn returns', async () => {
    expect(await runSpawnProbe({ cwd: '/definitely-missing-ui-client-path' }))
      .toMatch(/^(sync|async):ENOENT$/)
  })

  it('runs the diagnostic spawn matrix serially without user commands or paths', async () => {
    expect(await probeSpawnVariants(process.cwd())).toEqual({
      probePipeDetached: 'ok',
      probePipeAttached: 'ok',
      probeIgnoreDetached: 'ok',
      probePipeDetachedCwd: 'ok'
    })
  })

  it('ensureSpawnHealth reports the healthy startup baseline', async () => {
    const result = await ensureSpawnHealth()
    expect(result.ok).toBe(true)
    expect(result.fdCount).toBeGreaterThan(0)
  })

  it('includes swallowed EPIPE history in the next spawn snapshot', () => {
    recordSpawnRelatedEpipe()
    const snapshot = captureSpawnDiagnostics()
    expect(snapshot.epipeCount).toBeGreaterThan(0)
    expect(snapshot.lastEpipeAgoMs).toBeGreaterThanOrEqual(0)
  })
})

describe('spawn EBADF self-healing wiring', () => {
  const spawnTurnSource = readFileSync(new URL('../claude-headless/spawn-turn.ts', import.meta.url), 'utf-8')
  const indexSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf-8')

  it('spawn-turn catches EBADF, repairs fds, retries once, then fails with a friendly message', () => {
    expect(spawnTurnSource).toContain("code === 'EBADF'")
    expect(spawnTurnSource).toContain('repairMissingStdioFds()')
    expect(spawnTurnSource).toContain('probeSpawnVariants(effectiveCwd)')
    expect(spawnTurnSource).toContain("'ai.spawn.sync_failed'")
    expect(spawnTurnSource).toContain("'ai.spawn.repair_attempted'")
    expect(spawnTurnSource).toContain("'ai.spawn.probe_matrix'")
    expect(spawnTurnSource).toContain("'ai.spawn.retry_failed'")
    expect(spawnTurnSource).toContain("'ai.spawn.async_failed'")
    expect(spawnTurnSource).toContain("'ai.spawn.process_started'")
    expect(spawnTurnSource).toContain('ebadfFriendlyError')
    expect(spawnTurnSource).toContain('请完全退出 App（Cmd+Q）后重新打开再试')
  })

  it('main runs the startup spawn self-check after PATH hydration', () => {
    const hydratePos = indexSource.indexOf('hydrateProcessPathSync()')
    const checkPos = indexSource.indexOf('ensureSpawnHealth({')
    expect(hydratePos).toBeGreaterThan(-1)
    expect(checkPos).toBeGreaterThan(hydratePos)
  })

  it('main suppresses console EPIPE without swallowing unrelated socket failures', () => {
    expect(indexSource).toContain('isConsoleEpipe')
    expect(indexSource).toContain("stack.includes('electron-log')")
    expect(indexSource).toContain('recordSpawnRelatedEpipe()')
  })
})
