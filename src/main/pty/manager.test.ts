import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ptySpawnMock = vi.hoisted(() => vi.fn())
const spawnSyncMock = vi.hoisted(() => vi.fn())
const resolveCliSyncMock = vi.hoisted(() => vi.fn())
const ensureSpawnHelpersExecutableMock = vi.hoisted(() => vi.fn())

vi.mock('node-pty', () => ({
  spawn: ptySpawnMock
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawnSync: spawnSyncMock
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: vi.fn()
  }
}))

vi.mock('../system/cli-resolver', () => ({
  resolveCliSync: resolveCliSyncMock
}))

vi.mock('../system/find-command', () => ({
  findCommandAsync: vi.fn(async () => null),
  findCommandSync: vi.fn(() => null)
}))

vi.mock('./node-pty-helper', () => ({
  ensureNodePtySpawnHelpersExecutable: ensureSpawnHelpersExecutableMock
}))

import { createTty } from './manager'

describe('createTty diagnostics', () => {
  const originalShell = process.env.SHELL
  let tempDirs: string[] = []

  beforeEach(() => {
    tempDirs = []
    process.env.SHELL = '/bin/zsh'
    ptySpawnMock.mockReset()
    ptySpawnMock.mockImplementation(() => {
      throw new Error('posix_spawnp failed')
    })
    resolveCliSyncMock.mockReset()
    resolveCliSyncMock.mockReturnValue({ kind: 'claude', bin: 'claude', found: false, wrapArgs: (args: string[]) => args })
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({ status: 0, stderr: '' })
    ensureSpawnHelpersExecutableMock.mockReset()
  })

  afterEach(() => {
    process.env.SHELL = originalShell
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  })

  it('probes the fallback login shell without appending a version flag', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pty-manager-'))
    tempDirs.push(cwd)
    const shell = join(cwd, 'claude')
    writeFileSync(shell, 'binary')

    expect(() => createTty({ shell, args: ['--debug'], cwd, ownerWindowId: 1 }))
      .toThrow(/shell 诊断/)

    expect(spawnSyncMock).toHaveBeenCalledWith(shell, ['--debug', '--version'], expect.any(Object))
    expect(spawnSyncMock).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'echo ok'], expect.any(Object))
    expect(spawnSyncMock).not.toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'echo ok', '--version'], expect.any(Object))
  })
})

describe('createTty default args', () => {
  const originalShell = process.env.SHELL

  beforeEach(() => {
    process.env.SHELL = '/bin/zsh'
    ptySpawnMock.mockReset()
    ptySpawnMock.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn()
    })
    resolveCliSyncMock.mockReset()
    resolveCliSyncMock.mockReturnValue({ kind: 'claude', bin: 'claude', found: false, wrapArgs: (args: string[]) => args })
    spawnSyncMock.mockReset()
    ensureSpawnHelpersExecutableMock.mockReset()
  })

  afterEach(() => {
    process.env.SHELL = originalShell
  })

  it('applies default args only when the default command is Claude Code', () => {
    resolveCliSyncMock.mockReturnValue({ kind: 'claude', bin: '/usr/local/bin/claude', found: true, wrapArgs: (args: string[]) => args })

    createTty({ defaultArgs: ['--add-dir', '/repo'], cwd: '/repo/feature', ownerWindowId: 1 })

    expect(ptySpawnMock).toHaveBeenCalledWith('/usr/local/bin/claude', ['--add-dir', '/repo'], expect.objectContaining({
      cwd: '/repo/feature'
    }))
  })

  it('does not pass default Claude args to the fallback user shell', () => {
    createTty({ defaultArgs: ['--add-dir', '/repo'], cwd: '/repo/feature', ownerWindowId: 1 })

    expect(ptySpawnMock).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({
      cwd: '/repo/feature'
    }))
  })
})
