import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerIpcHandlerMock = vi.hoisted(() => vi.fn())
const createTtyMock = vi.hoisted(() => vi.fn(() => 'tty-1'))
const activeIdMock = vi.hoisted(() => vi.fn(async () => 'ws-1'))
const findByIdMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'ws-1',
  kind: 'project',
  name: 'demo',
  path: '/repo',
  defaultBranch: 'main',
  addedAt: '2026-06-25T00:00:00.000Z',
  lastActiveAt: '2026-06-25T00:00:00.000Z'
})))
const readActiveWorkAreaMock = vi.hoisted(() => vi.fn(async () => ({ kind: 'feature', relPath: 'features/payments' })))
const resolveClaudeLaunchContextMock = vi.hoisted(() => vi.fn(() => ({
  workDir: '/repo/features/payments',
  addDirs: ['/repo', '/repo/.external']
})))
const getClaudeCapabilitiesSyncMock = vi.hoisted(() => vi.fn(() => ({
  binPath: '/usr/local/bin/claude',
  version: 'claude 1.0.90',
  partialMessages: true,
  addDir: true,
  authStatus: 'ok'
})))

vi.mock('../registry', () => ({
  registerIpcHandler: registerIpcHandlerMock
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => ({ id: 7 }),
    getAllWindows: () => []
  }
}))

vi.mock('../../pty/manager', () => ({
  createTty: createTtyMock,
  killTty: vi.fn(),
  resizeTty: vi.fn(),
  writeTty: vi.fn()
}))

vi.mock('../../workspaces/store', () => ({
  WorkspacesStore: class {
    activeId = activeIdMock
    findById = findByIdMock
  }
}))

vi.mock('../../workspaces/work-area', () => ({
  readActiveWorkArea: readActiveWorkAreaMock
}))

vi.mock('../../claude-headless/launch-context', () => ({
  resolveClaudeLaunchContext: resolveClaudeLaunchContextMock
}))

vi.mock('../../claude-headless/capability-probe', () => ({
  getClaudeCapabilitiesSync: getClaudeCapabilitiesSyncMock
}))

import { registerTerminalHandlers } from './terminal'

function terminalCreateHandler(): (input: unknown) => Promise<unknown> {
  registerTerminalHandlers()
  const entry = registerIpcHandlerMock.mock.calls.find(([channel]) => channel === 'terminal.create')
  expect(entry).toBeTruthy()
  return entry![1]
}

beforeEach(() => {
  registerIpcHandlerMock.mockClear()
  createTtyMock.mockClear()
  activeIdMock.mockClear()
  findByIdMock.mockClear()
  readActiveWorkAreaMock.mockClear()
  resolveClaudeLaunchContextMock.mockClear()
  getClaudeCapabilitiesSyncMock.mockClear()
})

describe('terminal.create', () => {
  it('starts TUI in the same active work area as UI mode', async () => {
    const handler = terminalCreateHandler()

    await expect(handler({ cols: 120, rows: 40 })).resolves.toEqual({ ttyId: 'tty-1' })

    expect(resolveClaudeLaunchContextMock).toHaveBeenCalledWith('/repo', { kind: 'feature', relPath: 'features/payments' })
    expect(createTtyMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/repo/features/payments',
      defaultArgs: ['--add-dir', '/repo', '/repo/.external'],
      cols: 120,
      rows: 40,
      ownerWindowId: 7
    }))
  })

  it('keeps an explicit cwd override', async () => {
    const handler = terminalCreateHandler()

    await handler({ cwd: '/custom', cols: 80, rows: 24 })

    expect(resolveClaudeLaunchContextMock).not.toHaveBeenCalled()
    expect(createTtyMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/custom',
      defaultArgs: undefined
    }))
  })
})
