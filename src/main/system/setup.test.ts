import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() =>
  vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(new Error('not mocked'), { stdout: '', stderr: '' })
  })
)
const existsSyncMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/tmp/workspace-app',
    getPath: () => '/tmp/workspace-app'
  }
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: existsSyncMock
  }
})

import { checkEnvironment } from './setup'
import { _testOnlyResetBinaryCache } from '../git/binary'

// 极简 mock：execFile 是 (cmd, args, opts, cb) → cb(err, { stdout, stderr })
function mockGitConfig(name: string | null, email: string | null): void {
  execFileMock.mockImplementation((cmd, args, _opts, cb) => {
    const isGetUser = args[0] === 'config' && args[1] === '--global' && args[2] === '--get'
    if (isGetUser) {
      if (args[3] === 'user.name') {
        if (name) cb(null, { stdout: name + '\n', stderr: '' })
        else cb(new Error('not set'), { stdout: '', stderr: '' })
        return
      }
      if (args[3] === 'user.email') {
        if (email) cb(null, { stdout: email + '\n', stderr: '' })
        else cb(new Error('not set'), { stdout: '', stderr: '' })
        return
      }
    }
    cb(new Error(`unexpected: ${cmd} ${args.join(' ')}`), { stdout: '', stderr: '' })
  })
}

beforeEach(() => {
  execFileMock.mockReset()
  existsSyncMock.mockReset()
  existsSyncMock.mockReturnValue(false)
  _testOnlyResetBinaryCache()
})

describe('checkEnvironment（极简版，不做 -lic shell 探测）', () => {
  it('bundled git binary 找不到 → gitBinaryReady=false，gitUser 未配 → blocking', async () => {
    mockGitConfig(null, null)

    const result = await checkEnvironment()

    expect(result.gitBinaryReady).toBe(false)
    expect(result.gitUser.configured).toBe(false)
    expect(result).not.toHaveProperty('claudeGuideUrl')
  })

  it('bundled git 就绪 + 邮箱合法 → gitBinaryReady=true, configured=true', async () => {
    // existsSync 返 true 模拟 bundled git 在
    existsSyncMock.mockReturnValue(true)
    mockGitConfig('Alice', 'user@example.com')

    const result = await checkEnvironment()

    expect(result.gitBinaryReady).toBe(true)
    expect(result.gitUser).toEqual({
      name: 'Alice',
      email: 'user@example.com',
      configured: true
    })
  })

  it('bundled git 就绪但邮箱格式不合法 → configured=false', async () => {
    existsSyncMock.mockReturnValue(true)
    mockGitConfig('Alice', 'not-an-email')

    const result = await checkEnvironment()

    expect(result.gitUser.configured).toBe(false)
  })
})
