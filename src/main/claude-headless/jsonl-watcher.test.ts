import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

const webContentsSend = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: vi.fn(() => ({ webContents: { send: webContentsSend } }))
  }
}))

import { watchJsonl } from './jsonl-watcher'

let dir: string

beforeEach(async () => {
  webContentsSend.mockClear()
  dir = await mkdtemp(join(tmpdir(), 'ui-client-jsonl-watcher-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('watchJsonl', () => {
  it('reports unreadable session log errors to the renderer', () => {
    const errors: Array<{ message: string }> = []

    const watcher = watchJsonl(dir, {
      ownerWindowId: 1,
      sessionId: 'session-1',
      onReplay: vi.fn(),
      onAppend: vi.fn(),
      onError: (error) => errors.push(error)
    })

    watcher.stop()

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('读取 Claude 会话日志失败')
    expect(webContentsSend).toHaveBeenCalledWith(
      'claude.turn-error:session-1',
      expect.objectContaining({
        message: expect.stringContaining('读取 Claude 会话日志失败')
      })
    )
  })
})
