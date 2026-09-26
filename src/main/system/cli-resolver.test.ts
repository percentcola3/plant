import { beforeEach, describe, expect, it, vi } from 'vitest'

const findCommandSyncMock = vi.hoisted(() => vi.fn())
const settingsState = vi.hoisted(() => ({
  cached: null as { cliKind: 'claude' | 'dcc' } | null
}))

vi.mock('./find-command', () => ({
  findCommandSync: findCommandSyncMock,
  findCommandAsync: vi.fn()
}))

vi.mock('../settings/store', () => ({
  settingsStore: {
    getCached: () => settingsState.cached,
    get: vi.fn()
  }
}))

import { resetCliResolverCacheForTests, resolveCliSync } from './cli-resolver'

beforeEach(() => {
  settingsState.cached = null
  findCommandSyncMock.mockReset()
  resetCliResolverCacheForTests()
})

describe('resolveCliSync', () => {
  it('defaults to DCC before settings are loaded', () => {
    findCommandSyncMock.mockReturnValue('/usr/local/bin/dcc')

    const cli = resolveCliSync()

    expect(findCommandSyncMock).toHaveBeenCalledWith('dcc')
    expect(cli).toMatchObject({ kind: 'dcc', bin: '/usr/local/bin/dcc', found: true })
    expect(cli.wrapArgs(['--resume', 'session-id'])).toEqual(['--', '--resume', 'session-id'])
  })

  it('keeps an explicit Claude selection', () => {
    settingsState.cached = { cliKind: 'claude' }
    findCommandSyncMock.mockReturnValue('/usr/local/bin/claude')

    expect(resolveCliSync()).toMatchObject({ kind: 'claude', bin: '/usr/local/bin/claude', found: true })
  })
})
