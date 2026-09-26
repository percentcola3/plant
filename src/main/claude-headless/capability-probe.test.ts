import { afterEach, describe, expect, it, vi } from 'vitest'

// mock cli-resolver：绕开 settings store → electron 的导入链（测试环境无 electron），
// 并固定 bin 路径与 wrapArgs
vi.mock('../system/cli-resolver', () => ({
  resolveCli: async () => ({ kind: 'claude', bin: '/usr/local/bin/claude', found: true, wrapArgs: (a: string[]) => a }),
  resolveCliSync: () => ({ kind: 'claude', bin: '/usr/local/bin/claude', found: true, wrapArgs: (a: string[]) => a })
}))

// mock execFile（callback 风格，promisify 会传 (err, {stdout, stderr}) 回调）
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void
    const params = args.slice(0, -1) as [string, string[]]
    const result = execFileMock(...params)
    // execFileMock 返回 [err, stdout, stderr] 或 throw
    if (Array.isArray(result) && result.length === 3) {
      const [err, stdout, stderr] = result
      cb(err, { stdout, stderr })
    } else {
      cb(new Error('mock: unexpected call'), { stdout: '', stderr: '' })
    }
  }
}))

import {
  probeClaudeCapabilities,
  getClaudeCapabilitiesSync,
  resetClaudeCapabilitiesCacheForTests,
  setClaudeCapabilitiesCacheForTests
} from './capability-probe'

describe('capability-probe', () => {
  afterEach(() => {
    resetClaudeCapabilitiesCacheForTests()
    execFileMock.mockReset()
  })

  it('detects partialMessages + addDir from --help output', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === '-p' && args[1] === '--help') {
        return [null, 'Options:\n  --include-partial-messages\n  --add-dir\n  --mcp-config <file>\n', '']
      }
      if (args[0] === 'auth' && args[1] === 'status') {
        return [null, 'Logged in as user@example.com', '']
      }
      if (args[0] === '--version') {
        return [null, 'claude 1.0.92\n', '']
      }
      return [new Error('unexpected'), '', '']
    })

    const caps = await probeClaudeCapabilities()
    expect(caps.partialMessages).toBe(true)
    expect(caps.addDir).toBe(true)
    expect(caps.mcpConfig).toBe(true)
    expect(caps.authStatus).toBe('ok')
    expect(caps.version).toBe('claude 1.0.92')
    expect(caps.binPath).toBe('/usr/local/bin/claude')
  })

  it('falls back to false when flags absent (old claude)', async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === '-p' && args[1] === '--help') {
        return [null, 'Options:\n  --print\n  --verbose\n', '']  // 无 partial / add-dir
      }
      if (args[0] === 'auth' && args[1] === 'status') {
        return [new Error('not logged in'), '', 'Error: not authenticated']
      }
      return [null, 'claude 1.0.80\n', '']
    })

    const caps = await probeClaudeCapabilities()
    expect(caps.partialMessages).toBe(false)
    expect(caps.addDir).toBe(false)
    expect(caps.authStatus).toBe('missing')
  })

  it('returns conservative defaults when probe throws', async () => {
    execFileMock.mockImplementation(() => [new Error('ENOENT'), '', ''])

    const caps = await probeClaudeCapabilities()
    expect(caps.partialMessages).toBe(false)
    expect(caps.addDir).toBe(false)
    expect(caps.authStatus).toBe('unknown')
  })

  it('getClaudeCapabilitiesSync returns cached after probe', async () => {
    execFileMock.mockImplementation(() => [null, '--include-partial-messages', ''])
    await probeClaudeCapabilities()

    // 同步读取应命中缓存
    const sync = getClaudeCapabilitiesSync()
    expect(sync.partialMessages).toBe(true)
  })

  it('getClaudeCapabilitiesSync returns conservative defaults before any probe', () => {
    resetClaudeCapabilitiesCacheForTests()
    const sync = getClaudeCapabilitiesSync()
    expect(sync.partialMessages).toBe(false)
    expect(sync.authStatus).toBe('unknown')
  })

  it('setCacheForTests injects values without real probe', () => {
    setClaudeCapabilitiesCacheForTests({
      binPath: '/x/claude',
      version: 'test',
      partialMessages: true,
      addDir: false,
      appendSystemPrompt: false,
      mcpConfig: false,
      authStatus: 'ok'
    })
    expect(getClaudeCapabilitiesSync().partialMessages).toBe(true)
  })
})
