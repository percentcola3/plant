import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEntry } from '../diagnostics/service'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
  entries: [] as DiagnosticEntry[]
}))

vi.mock('electron', () => ({ app: { getAppPath: () => '/app/Resources/app.asar' } }))
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(), existsSync: mocks.existsSync
}))
vi.mock('node:child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }))
vi.mock('../diagnostics/runtime', async () => {
  const { createDiagnosticsService } = await import('../diagnostics/service')
  return { diagnostics: createDiagnosticsService({ write: (entry) => mocks.entries.push(entry) }) }
})

import { resetZgRuntimeCacheForTests, resolveZgScript, runZg, runZgStream } from './zg-runtime'

const script = '/app/Resources/app.asar.unpacked/node_modules/@zvec/zvec-grep/dist/cli/index.js'
const cwd = '/Users/alice/workspace'

function processMock() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn()
  })
}

function finishedEntries() {
  return mocks.entries.filter((entry) => entry.event === 'zg.process.finished')
}

describe('zg runtime diagnostics and process failures', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.entries.length = 0
    mocks.existsSync.mockImplementation((path) => path === script)
    resetZgRuntimeCacheForTests()
  })

  afterEach(() => vi.useRealTimers())

  it('locates the unpacked CLI and records a persisted event once', () => {
    expect(resolveZgScript()).toBe(script)
    expect(resolveZgScript()).toBe(script)
    expect(mocks.entries).toHaveLength(1)
    expect(mocks.entries[0]).toMatchObject({
      event: 'zg.runtime.resolved', attributes: { success: true, relativePath: script }
    })
  })

  it('records unavailable paths and skips execution when the CLI is missing', async () => {
    mocks.existsSync.mockReturnValue(false)
    const result = await runZg(['index'], { cwd })
    expect(result).toMatchObject({ code: -1, stderr: 'zg script not found' })
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'zg.runtime.unavailable', attributes: expect.objectContaining({
        success: false, relativePath: expect.stringContaining(script)
      }) }),
      expect.objectContaining({ event: 'zg.process.skipped' })
    ]))
  })

  it('preserves execFile ENOENT even when no stderr was produced', async () => {
    const error = Object.assign(new Error('spawn Electron ENOENT'), { code: 'ENOENT', syscall: 'spawn Electron' })
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(error, '', ''))
    await expect(runZg(['status'], { cwd })).resolves.toMatchObject({
      code: 1, stderr: 'ENOENT: spawn Electron ENOENT', killed: false
    })
    expect(finishedEntries()).toEqual([expect.objectContaining({
      level: 'warn', attributes: expect.objectContaining({
        name: 'status', sessionTarget: '~/workspace', exitCode: 1, code: 'ENOENT',
        reason: 'ENOENT: spawn Electron ENOENT'
      })
    })])
  })

  it('records the missing dependency and path from index startup stderr', async () => {
    const stderr = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'jsonc-parser' imported from /Users/alice/App.app/Contents/Resources/app.asar.unpacked/node_modules/@zvec/zvec-grep/dist/cli/index.js"
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback({ code: 1 }, '', stderr))
    await runZg(['index'], { cwd })
    expect(finishedEntries()[0].attributes?.reason).toContain("ERR_MODULE_NOT_FOUND]: Cannot find package 'jsonc-parser'")
    expect(finishedEntries()[0].attributes?.reason).toContain('~/App.app/Contents/Resources/app.asar.unpacked')
  })

  it.each([0, 1])('does not persist query text or query output (exit %s)', async (code) => {
    const secret = 'private search phrase'
    const content = 'private source content'
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(
      code ? { code } : null,
      `Q1 [primary]: ${secret}\n1\t${content}`,
      code ? `Error: ${secret}\nCode: ZVEC_GREP.ENGINE.NOT_READY\n${content}` : ''
    ))
    await runZg(['query', secret, '--limit', '20'], { cwd })
    const logged = JSON.stringify(mocks.entries)
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain(content)
    if (code) expect(finishedEntries()[0].attributes?.code).toBe('ZVEC_GREP.ENGINE.NOT_READY')
  })

  it('preserves stream process errors and finishes only once when close follows error', async () => {
    const child = processMock()
    mocks.spawn.mockReturnValue(child)
    const result = runZgStream(['index'], { cwd }, vi.fn())
    child.emit('error', Object.assign(new Error('spawn Electron ENOENT'), { code: 'ENOENT' }))
    child.emit('close', -2)
    await expect(result).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining('ENOENT') })
    expect(finishedEntries()).toHaveLength(1)
    expect(finishedEntries()[0].attributes?.code).toBe('ENOENT')
  })

  it('retains streaming callbacks and timeout state', async () => {
    vi.useFakeTimers()
    const child = processMock()
    const onChunk = vi.fn()
    mocks.spawn.mockReturnValue(child)
    const result = runZgStream(['index'], { cwd, timeoutMs: 100 }, onChunk)
    child.stdout.emit('data', Buffer.from('Scanning files...'))
    vi.advanceTimersByTime(100)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    await expect(result).resolves.toMatchObject({ code: 1, killed: true, stdout: 'Scanning files...' })
    expect(onChunk).toHaveBeenCalledWith('stdout', 'Scanning files...')
    expect(finishedEntries()[0].attributes?.signal).toBe('SIGKILL')
  })

  it.each(['execFile', 'spawn'] as const)('returns a synchronous %s launch failure without rejecting', async (method) => {
    mocks[method].mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })
    const result = method === 'execFile'
      ? runZg(['index'], { cwd })
      : runZgStream(['index'], { cwd }, vi.fn())
    await expect(result).resolves.toMatchObject({ code: 1, stderr: 'EACCES: permission denied' })
    expect(finishedEntries()).toHaveLength(1)
  })
})
