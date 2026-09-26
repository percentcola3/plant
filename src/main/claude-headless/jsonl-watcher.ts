// JSONL 文件监听：全量回放 + 增量追加
import { watchFile, unwatchFile, readFileSync, statSync, type Stats } from 'node:fs'
import { BrowserWindow } from 'electron'

export type JsonlEvent = { type: string; uuid: string; [key: string]: unknown }

export type WatchOptions = {
  ownerWindowId: number
  sessionId: string
  onReplay: (events: JsonlEvent[]) => void
  onAppend: (events: JsonlEvent[]) => void
  onError?: (error: { message: string; phase: 'replay' | 'incremental'; details?: string }) => void
}

export type WatchHandle = { stop(): void }

const DEBOUNCE_MS = 300

export function watchJsonl(filePath: string, opts: WatchOptions): WatchHandle {
  let stopped = false
  let offset = 0     // 已读字节偏移
  let lastUuid = ''  // 最后一行的 uuid，用于去重（macOS fs.watch 旧内容 bug）
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const win = BrowserWindow.fromId(opts.ownerWindowId)

  // 全量回放
  try {
    const content = readFileSync(filePath, 'utf-8')
    if (content.trim()) {
      const events = parseLines(content)
      if (events.length > 0) {
        lastUuid = events[events.length - 1].uuid
        offset = Buffer.byteLength(content, 'utf-8')
        opts.onReplay(events)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      reportError('replay', error)
    }
  }

  // 增量监听：用 watchFile（比 fs.watch 更跨平台可靠）
  const listener = (_curr: Stats, _prev: Stats) => {
    if (stopped) return
    // 防抖
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => readIncremental(), DEBOUNCE_MS)
  }

  watchFile(filePath, { interval: 1000 }, listener)

  function readIncremental() {
    if (stopped) return
    try {
      const stat = statSync(filePath)
      if (stat.size <= offset) return

      const content = readFileSync(filePath, 'utf-8')
      // 只读新增部分
      const newContent = Buffer.from(content, 'utf-8').slice(offset).toString('utf-8')
      if (!newContent.trim()) return

      const events = parseLines(newContent)
      if (events.length === 0) return

      // macOS fs.watch 旧内容 bug：比对最后一行 uuid
      if (events.length === 1 && events[0].uuid === lastUuid) {
        // 重试一次：等 500ms 再读
        setTimeout(() => {
          try {
            const retry = readFileSync(filePath, 'utf-8')
            const retryNew = Buffer.from(retry, 'utf-8').slice(offset).toString('utf-8')
            const retryEvents = parseLines(retryNew)
            if (retryEvents.length > 1 || (retryEvents.length === 1 && retryEvents[0].uuid !== lastUuid)) {
              lastUuid = retryEvents[retryEvents.length - 1].uuid
              offset = Buffer.byteLength(retry, 'utf-8')
              opts.onAppend(retryEvents)
              // 也推送给 renderer
              win?.webContents.send(`claude.jsonl-append:${opts.sessionId}`, retryEvents)
            }
          } catch { /* ignore */ }
        }, 500)
        return
      }

      lastUuid = events[events.length - 1].uuid
      offset = Buffer.byteLength(content, 'utf-8')
      opts.onAppend(events)
      win?.webContents.send(`claude.jsonl-append:${opts.sessionId}`, events)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        reportError('incremental', error)
      }
    }
  }

  function reportError(phase: 'replay' | 'incremental', error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    const payload = {
      phase,
      message: `读取 Claude 会话日志失败：${detail}`,
      details: detail
    }
    opts.onError?.(payload)
    win?.webContents.send(`claude.turn-error:${opts.sessionId}`, payload)
  }

  return {
    stop() {
      stopped = true
      if (debounceTimer) clearTimeout(debounceTimer)
      try { unwatchFile(filePath, listener) } catch { /* ignore */ }
    }
  }
}

// 解析 NDJSON，跳过损坏行
function parseLines(content: string): JsonlEvent[] {
  const events: JsonlEvent[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as JsonlEvent)
    } catch {
      // 跳过损坏行
    }
  }
  return events
}
