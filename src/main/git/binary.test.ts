import { describe, expect, it, beforeEach, vi } from 'vitest'

const execSyncMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn(() => false))
const requireResolveMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execSync: execSyncMock }))
vi.mock('node:fs', async (orig) => ({
  ...await orig<typeof import('node:fs')>(),
  existsSync: existsSyncMock
}))
vi.mock('node:module', () => ({
  createRequire: () => Object.assign(() => undefined, { resolve: requireResolveMock })
}))

import { _testOnlyResetBinaryCache, isBundled, resolveGitBinary } from './binary'

beforeEach(() => {
  execSyncMock.mockReset()
  existsSyncMock.mockReset()
  existsSyncMock.mockReturnValue(false)
  requireResolveMock.mockReset()
  _testOnlyResetBinaryCache()
})

describe('resolveGitBinary', () => {
  it('returns dugite bundled path when present', () => {
    requireResolveMock.mockReturnValue('/proj/node_modules/dugite/package.json')
    existsSyncMock.mockImplementation((p: string) => p === '/proj/node_modules/dugite/git/bin/git')
    expect(resolveGitBinary()).toBe('/proj/node_modules/dugite/git/bin/git')
    expect(isBundled()).toBe(true)
  })

  it('replaces app.asar with app.asar.unpacked when packaged', () => {
    requireResolveMock.mockReturnValue('/Applications/Foo.app/Contents/Resources/app.asar/node_modules/dugite/package.json')
    existsSyncMock.mockImplementation((p: string) =>
      p === '/Applications/Foo.app/Contents/Resources/app.asar.unpacked/node_modules/dugite/git/bin/git'
    )
    expect(resolveGitBinary())
      .toBe('/Applications/Foo.app/Contents/Resources/app.asar.unpacked/node_modules/dugite/git/bin/git')
  })

  it('falls back to system git when dugite not installed', () => {
    requireResolveMock.mockImplementation(() => { throw new Error('not found') })
    execSyncMock.mockImplementation(() => '/usr/bin/git\n')
    existsSyncMock.mockImplementation((p: string) => p === '/usr/bin/git')
    expect(resolveGitBinary()).toBe('/usr/bin/git')
    expect(isBundled()).toBe(false)
  })

  it('returns null when neither bundled nor system git available', () => {
    requireResolveMock.mockImplementation(() => { throw new Error('not found') })
    execSyncMock.mockImplementation(() => { throw new Error('not found') })
    expect(resolveGitBinary()).toBeNull()
  })

  it('caches result across calls', () => {
    requireResolveMock.mockReturnValue('/proj/node_modules/dugite/package.json')
    existsSyncMock.mockImplementation((p: string) => p === '/proj/node_modules/dugite/git/bin/git')
    resolveGitBinary()
    resolveGitBinary()
    expect(requireResolveMock).toHaveBeenCalledTimes(1)
  })

  it('returns null on Windows when git.exe not present even if pkg path resolves', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    requireResolveMock.mockReturnValue('C:/proj/node_modules/dugite/package.json')
    execSyncMock.mockImplementation(() => { throw new Error('not found') })
    // existsSyncMock 默认 false → bundled 找不到 → fallback 系统也没有 → null
    expect(resolveGitBinary()).toBeNull()
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
  })
})
