// LegacySpawnDriver 行为契约（不真起 claude 进程，mock spawn-turn）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TurnHandle } from '../spawn-turn'

const spawnTurnMock = vi.fn()
const spawnResumeTurnMock = vi.fn()

vi.mock('../spawn-turn', () => ({
  spawnTurn: (...args: unknown[]) => spawnTurnMock(...args),
  spawnResumeTurn: (...args: unknown[]) => spawnResumeTurnMock(...args)
}))

import { LegacySpawnDriver } from './legacy-spawn'

type Listener = (code: number | null, signal?: string) => void

function makeFakeHandle(): TurnHandle & { triggerExit(): void; abortMock: ReturnType<typeof vi.fn> } {
  const exitListeners: Listener[] = []
  const abortMock = vi.fn(async () => {})
  return {
    pid: 123,
    abort: abortMock,
    onEvent: () => () => {},
    onExit: (cb) => {
      exitListeners.push(cb)
      return () => {}
    },
    triggerExit() {
      for (const cb of exitListeners) cb(0)
    },
    abortMock
  }
}

const baseInput = {
  sessionId: 's-1',
  projectPath: '/tmp/proj',
  content: [{ type: 'text' as const, text: 'hi' }],
  permissionMode: 'bypassPermissions' as const,
  ownerWindowId: 1
}

describe('LegacySpawnDriver', () => {
  afterEach(() => {
    spawnTurnMock.mockReset()
    spawnResumeTurnMock.mockReset()
  })

  it('routes resume=false to spawnTurn and resume=true to spawnResumeTurn', () => {
    const driver = new LegacySpawnDriver()
    const h1 = makeFakeHandle()
    const h2 = makeFakeHandle()
    spawnTurnMock.mockReturnValueOnce(h1)
    spawnResumeTurnMock.mockReturnValueOnce(h2)

    driver.submit({ ...baseInput, resume: false })
    driver.submit({ ...baseInput, sessionId: 's-2', resume: true })

    expect(spawnTurnMock).toHaveBeenCalledTimes(1)
    expect(spawnResumeTurnMock).toHaveBeenCalledTimes(1)
  })

  it('tracks active turns until exit fires', () => {
    const driver = new LegacySpawnDriver()
    const handle = makeFakeHandle()
    spawnTurnMock.mockReturnValue(handle)

    driver.submit({ ...baseInput, resume: false })
    expect(driver.hasActiveTurn('s-1')).toBe(true)

    handle.triggerExit()
    expect(driver.hasActiveTurn('s-1')).toBe(false)
  })

  it('abort returns false when no active turn, true when there was one', async () => {
    const driver = new LegacySpawnDriver()
    expect(await driver.abort('missing')).toBe(false)

    const handle = makeFakeHandle()
    spawnTurnMock.mockReturnValue(handle)
    driver.submit({ ...baseInput, resume: false })

    expect(await driver.abort('s-1')).toBe(true)
    expect(handle.abortMock).toHaveBeenCalledTimes(1)
    expect(driver.hasActiveTurn('s-1')).toBe(false)
  })

  it('shutdown aborts every active turn and clears state', async () => {
    const driver = new LegacySpawnDriver()
    const h1 = makeFakeHandle()
    const h2 = makeFakeHandle()
    spawnTurnMock.mockReturnValueOnce(h1).mockReturnValueOnce(h2)

    driver.submit({ ...baseInput, sessionId: 's-A', resume: false })
    driver.submit({ ...baseInput, sessionId: 's-B', resume: false })

    await driver.shutdown()

    expect(h1.abortMock).toHaveBeenCalled()
    expect(h2.abortMock).toHaveBeenCalled()
    expect(driver.hasActiveTurn('s-A')).toBe(false)
    expect(driver.hasActiveTurn('s-B')).toBe(false)
  })

  it('exit listener does not delete a re-submitted handle from a later turn', () => {
    const driver = new LegacySpawnDriver()
    const stale = makeFakeHandle()
    const fresh = makeFakeHandle()
    spawnTurnMock.mockReturnValueOnce(stale).mockReturnValueOnce(fresh)

    driver.submit({ ...baseInput, resume: false })
    driver.submit({ ...baseInput, resume: false })   // 同一 sessionId 第二次提交，覆盖 map
    stale.triggerExit()                              // 旧 handle 退出，但 map 里已经是 fresh

    expect(driver.hasActiveTurn('s-1')).toBe(true)
  })
})
