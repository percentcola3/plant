import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const fakeHome = vi.hoisted(() => ({ path: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => fakeHome.path }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: () => null
  }
}))

import {
  branchScopedWorkspaceKey,
  ensureWorkspaceSessionId,
  sessionJsonlPath,
  sessionJsonlPathForReplay
} from './session-id'
import { watchJsonl, type JsonlEvent } from './jsonl-watcher'

let projectPath = ''

beforeEach(async () => {
  fakeHome.path = await mkdtemp(join(tmpdir(), 'ui-client-session-home-'))
  projectPath = await mkdtemp(join(tmpdir(), 'ui-client-session-project-'))
})

afterEach(async () => {
  await rm(fakeHome.path, { recursive: true, force: true })
  await rm(projectPath, { recursive: true, force: true })
})

describe('conversation session reload', () => {
  it('重启后复用根 Git 项目会话并回放历史', () => {
    const scope = branchScopedWorkspaceKey('main')
    const sessionBeforeRestart = ensureWorkspaceSessionId(projectPath, scope)
    // 会话首轮在某个 work area 中启动；重启后面板先从根目录恢复。
    const originalWorkDir = join(projectPath, 'features/payments')
    const jsonlPath = sessionJsonlPath(originalWorkDir, sessionBeforeRestart)
    mkdirSync(dirname(jsonlPath), { recursive: true })
    writeFileSync(jsonlPath, [
      JSON.stringify({
        type: 'user',
        uuid: 'user-1',
        message: { role: 'user', content: [{ type: 'text', text: '第一个问题' }] }
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        message: { role: 'assistant', content: [{ type: 'text', text: '第一个回答' }] }
      })
    ].join('\n') + '\n', 'utf-8')

    // 重启后会话 ID 从根 Git 项目持久化绑定恢复，watcher 从原 cwd 定位历史。
    const sessionAfterRestart = ensureWorkspaceSessionId(projectPath, scope)
    const replayed: JsonlEvent[] = []
    const replayPath = sessionJsonlPathForReplay(projectPath, sessionAfterRestart)
    const watcher = watchJsonl(replayPath, {
      ownerWindowId: 1,
      sessionId: sessionAfterRestart,
      onReplay: (events) => replayed.push(...events),
      onAppend: () => undefined
    })
    watcher.stop()

    expect(sessionAfterRestart).toBe(sessionBeforeRestart)
    expect(replayPath).toBe(jsonlPath)
    expect(replayed.map(event => event.uuid)).toEqual(['user-1', 'assistant-1'])
    expect(replayed.map(event => ({
      role: event.message && typeof event.message === 'object'
        ? (event.message as { role?: string }).role
        : undefined,
      text: event.message && typeof event.message === 'object'
        ? (event.message as { content?: Array<{ text?: string }> }).content?.[0]?.text
        : undefined
    })))
      .toEqual([
        { role: 'user', text: '第一个问题' },
        { role: 'assistant', text: '第一个回答' }
      ])
  })
})
