import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── mocks ──────────────────────────────────────────────────────────────
// 与 external-pool/service.test.ts 同款 electron / git client mock 风格。

const winSend = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: winSend } }]
  }
}))

const gitApi = vi.hoisted(() => ({
  raw: vi.fn(async () => 'origin\n'),
  fetch: vi.fn(async () => undefined)
}))
vi.mock('./client', () => ({
  gitFor: () => gitApi,
  gitForBackground: vi.fn(async () => gitApi)
}))

const probeInvalidate = vi.hoisted(() => vi.fn())
vi.mock('./probe', () => ({
  getSharedProbe: () => ({ invalidate: probeInvalidate })
}))

const active = vi.hoisted(() => ({ id: 'ws-1' as string | null }))
const workspace = vi.hoisted(() => ({ path: '/repo/demo', hasRemote: true }))
vi.mock('../workspaces/service', () => ({
  getActiveWorkspaceId: vi.fn(async () => active.id),
  getWorkspace: vi.fn(async () =>
    active.id && workspace.hasRemote
      ? { id: active.id, path: workspace.path, defaultBranch: 'main' }
      : null
  )
}))

import { startBackgroundFetch, stopBackgroundFetch } from './background-fetch'

beforeEach(() => {
  vi.useFakeTimers()
  active.id = 'ws-1'
  workspace.path = '/repo/demo'
  workspace.hasRemote = true
  gitApi.raw.mockReset()
  gitApi.raw.mockResolvedValue('origin\n')   // hasRemote → true
  gitApi.fetch.mockReset()
  gitApi.fetch.mockResolvedValue(undefined)
  probeInvalidate.mockReset()
  winSend.mockReset()
})

afterEach(() => {
  stopBackgroundFetch()
  vi.useRealTimers()
})

describe('background-fetch', () => {
  it('无活跃工作区时不 fetch', async () => {
    active.id = null
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(gitApi.fetch).not.toHaveBeenCalled()
    expect(probeInvalidate).not.toHaveBeenCalled()
  })

  it('无 remote 的工作区跳过', async () => {
    gitApi.raw.mockResolvedValue('')   // `git remote` 输出空 → no remote
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(gitApi.fetch).not.toHaveBeenCalled()
    expect(probeInvalidate).not.toHaveBeenCalled()
  })

  it('有 remote 时 fetch → invalidate → 广播', async () => {
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(gitApi.fetch).toHaveBeenCalledWith(['--all', '--prune'])
    expect(probeInvalidate).toHaveBeenCalledWith('/repo/demo')
    expect(winSend).toHaveBeenCalledWith('git.remote-updated:ws-1', { workspaceId: 'ws-1' })
  })

  it('fetch 抛错被吞，不 invalidate / 不广播', async () => {
    gitApi.fetch.mockRejectedValue(new Error('499 cache miss'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(probeInvalidate).not.toHaveBeenCalled()
    expect(winSend).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('按 5 分钟周期重复 fetch', async () => {
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)   // 首跑
    expect(gitApi.fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)   // 第一个周期
    expect(gitApi.fetch).toHaveBeenCalledTimes(2)
  })

  it('start 幂等：重复 start 不重复跑', async () => {
    startBackgroundFetch()
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(gitApi.fetch).toHaveBeenCalledTimes(1)
  })

  it('inFlight 守卫：上一轮未完成时跳过新一轮', async () => {
    // fetch 永不 resolve，runOnce 卡在 await
    gitApi.fetch.mockImplementation(() => new Promise(() => undefined))
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)   // 首跑触发，挂起
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)   // 周期触发 → inFlight，跳过

    // 只应有一次 fetch 调用（第二轮被 inFlight 拦下）
    expect(gitApi.fetch).toHaveBeenCalledTimes(1)
  })

  it('stop 清理 timer，不再触发 fetch', async () => {
    startBackgroundFetch()
    stopBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000 + 5 * 60 * 1000)

    expect(gitApi.fetch).not.toHaveBeenCalled()
  })

  it('stop 后可再次 start', async () => {
    startBackgroundFetch()
    stopBackgroundFetch()
    startBackgroundFetch()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(gitApi.fetch).toHaveBeenCalledTimes(1)
  })
})
