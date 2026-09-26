import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStartupWatchdog } from './watchdog'

describe('createStartupWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires when no stdout arrives before the startup deadline', () => {
    const onTimeout = vi.fn()
    const watchdog = createStartupWatchdog(1000, onTimeout)

    watchdog.start()
    vi.advanceTimersByTime(1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not fire after the first stdout event has arrived', () => {
    const onTimeout = vi.fn()
    const watchdog = createStartupWatchdog(1000, onTimeout)

    watchdog.start()
    vi.advanceTimersByTime(500)
    watchdog.markOutputSeen()
    vi.advanceTimersByTime(2000)

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('stop cancels the pending startup timeout', () => {
    const onTimeout = vi.fn()
    const watchdog = createStartupWatchdog(1000, onTimeout)

    watchdog.start()
    watchdog.stop()
    vi.advanceTimersByTime(1000)

    expect(onTimeout).not.toHaveBeenCalled()
  })
})
