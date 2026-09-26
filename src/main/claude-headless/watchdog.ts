export type StartupWatchdog = {
  start(): void
  markOutputSeen(): void
  stop(): void
}

export function createStartupWatchdog(
  timeoutMs: number,
  onTimeout: () => void
): StartupWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null
  let outputSeen = false
  let stopped = false

  function clearTimer(): void {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  return {
    start() {
      if (stopped || outputSeen) return
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        if (!stopped && !outputSeen) onTimeout()
      }, timeoutMs)
    },
    markOutputSeen() {
      if (outputSeen) return
      outputSeen = true
      clearTimer()
    },
    stop() {
      stopped = true
      clearTimer()
    }
  }
}
