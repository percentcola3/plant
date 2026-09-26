import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, afterEach } from 'vitest'
import { AiTaskStore } from './store'
import type { AiTaskSummary } from '@shared/types'

const tempDirs: string[] = []

async function makeStore(): Promise<{ dir: string; store: AiTaskStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'ui-client-ai-tasks-'))
  tempDirs.push(dir)
  return { dir, store: new AiTaskStore(join(dir, 'tasks.json')) }
}

function task(overrides: Partial<AiTaskSummary>): AiTaskSummary {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace 1',
    workspacePath: '/tmp/workspace-1',
    status: 'running',
    title: '生成登录页',
    promptPreview: '请生成登录页',
    workArea: { kind: 'feature', relPath: 'features/login' },
    createdAt: '2026-07-04T01:00:00.000Z',
    updatedAt: '2026-07-04T01:00:00.000Z',
    changedArtifacts: [],
    unread: false,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('AiTaskStore', () => {
  it('persists tasks and returns newest updated task first', async () => {
    const { store } = await makeStore()

    await store.upsert(task({ id: 'older', updatedAt: '2026-07-04T01:00:00.000Z' }))
    await store.upsert(task({ id: 'newer', sessionId: 'session-2', updatedAt: '2026-07-04T02:00:00.000Z' }))

    const reloaded = new AiTaskStore(store.filePath)
    const tasks = await reloaded.list()

    expect(tasks.map((item) => item.id)).toEqual(['newer', 'older'])
  })

  it('updates an existing task without duplicating it', async () => {
    const { store } = await makeStore()

    await store.upsert(task({ id: 'task-1', status: 'running' }))
    await store.upsert(task({ id: 'task-1', status: 'completed', changedArtifacts: ['features/login/index.html'] }))

    const tasks = await store.list()

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'task-1',
      status: 'completed',
      changedArtifacts: ['features/login/index.html']
    })
  })
})
