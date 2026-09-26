import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

import { sweepStaleAiTasks } from './sweep'
import { AiTaskStore } from './store'
import { _testOnlyResetAiTaskRegistry, aiTaskStorePath } from './service'

async function seedTasks(tasks: Array<{ id: string; status: string }>): Promise<void> {
  const p = aiTaskStorePath(electronPaths.userData)
  await fs.mkdir(join(electronPaths.userData, 'ai-tasks'), { recursive: true })
  const now = new Date('2026-07-09T00:00:00.000Z').toISOString()
  const full = tasks.map((t) => ({
    id: t.id,
    sessionId: `sess-${t.id}`,
    workspaceId: `ws-${t.id}`,
    workspaceName: 'ws',
    workspacePath: '/tmp/ws',
    status: t.status,
    title: `task ${t.id}`,
    promptPreview: 'p',
    workArea: { kind: 'workspace' },
    createdAt: now,
    updatedAt: now,
    changedArtifacts: [],
    unread: false
  }))
  await fs.writeFile(p, JSON.stringify({ schemaVersion: 1, tasks: full }), 'utf-8')
}

async function readStatuses(): Promise<Record<string, string>> {
  const store = new AiTaskStore(aiTaskStorePath(electronPaths.userData))
  const tasks = await store.list()
  const map: Record<string, string> = {}
  for (const t of tasks) map[t.id] = t.status
  return map
}

describe('sweepStaleAiTasks', () => {
  beforeEach(async () => {
    electronPaths.userData = await mkdtemp(join(tmpdir(), 'sweep-ai-tasks-'))
    _testOnlyResetAiTaskRegistry()
  })
  afterEach(async () => {
    _testOnlyResetAiTaskRegistry()
    await fs.rm(electronPaths.userData, { recursive: true, force: true }).catch(() => undefined)
  })

  it('把 running / waiting_user / waiting_approval 全部归为 aborted，终态不动', async () => {
    await seedTasks([
      { id: 'a', status: 'running' },
      { id: 'b', status: 'waiting_user' },
      { id: 'c', status: 'waiting_approval' },
      { id: 'd', status: 'completed' },
      { id: 'e', status: 'applied' },
      { id: 'f', status: 'failed' },
      { id: 'g', status: 'aborted' }
    ])
    const r = await sweepStaleAiTasks()
    expect(r.swept).toBe(3)
    const after = await readStatuses()
    expect(after).toEqual({
      a: 'aborted',
      b: 'aborted',
      c: 'aborted',
      d: 'completed',
      e: 'applied',
      f: 'failed',
      g: 'aborted'
    })
  })

  it('空文件 / 无活跃任务时无操作', async () => {
    await seedTasks([
      { id: 'x', status: 'applied' }
    ])
    const r = await sweepStaleAiTasks()
    expect(r.swept).toBe(0)
  })
})
