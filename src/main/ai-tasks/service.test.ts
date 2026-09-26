import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AiTaskRegistry } from './service'
import { AiTaskStore } from './store'

const tempDirs: string[] = []

async function makeRegistryParts(): Promise<{ registry: AiTaskRegistry; store: AiTaskStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'ui-client-ai-task-registry-'))
  tempDirs.push(dir)
  const store = new AiTaskStore(join(dir, 'tasks.json'))
  return {
    registry: new AiTaskRegistry(store, () => new Date('2026-07-04T03:00:00.000Z')),
    store
  }
}

async function makeRegistry(): Promise<AiTaskRegistry> {
  return (await makeRegistryParts()).registry
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('AiTaskRegistry', () => {
  it('shows only the latest task for a project when legacy data contains duplicates', async () => {
    const { registry, store } = await makeRegistryParts()
    const oldTask = await registry.recordRunning({
      sessionId: 'session-old',
      workspaceId: 'workspace-1',
      workspaceName: 'Saas2',
      workspacePath: '/tmp/saas2',
      prompt: '旧任务',
      workArea: { kind: 'ui-product', relPath: 'outputs/project-a' }
    })
    await store.upsert({
      ...oldTask,
      id: 'session-new',
      sessionId: 'session-new',
      title: '新任务',
      updatedAt: '2026-07-04T03:01:00.000Z',
      lastEventAt: '2026-07-04T03:01:00.000Z'
    })

    const tasks = await registry.list()
    expect(tasks.map((task) => task.sessionId)).toEqual(['session-new'])
  })

  it('replaces the previous task in the same project scope while keeping other projects', async () => {
    const registry = await makeRegistry()
    await registry.recordRunning({
      sessionId: 'session-old',
      workspaceId: 'workspace-1',
      workspaceName: 'Saas2',
      workspacePath: '/tmp/saas2',
      prompt: '旧任务',
      workArea: { kind: 'ui-product', relPath: 'outputs/project-a' }
    })
    await registry.recordRunning({
      sessionId: 'session-other',
      workspaceId: 'workspace-1',
      workspaceName: 'Saas2',
      workspacePath: '/tmp/saas2',
      prompt: '另一个项目任务',
      workArea: { kind: 'ui-product', relPath: 'outputs/project-b' }
    })

    const result = await registry.recordRunningReplacingScope({
      sessionId: 'session-new',
      workspaceId: 'workspace-1',
      workspaceName: 'Saas2',
      workspacePath: '/tmp/saas2',
      prompt: '新任务',
      workArea: { kind: 'ui-product', relPath: 'outputs/project-a/' }
    })

    expect(result.replaced.map((task) => task.sessionId)).toEqual(['session-old'])
    const tasks = await registry.list()
    expect(tasks).toHaveLength(2)
    expect(tasks).toEqual(expect.arrayContaining([
      { sessionId: 'session-new', workArea: { relPath: 'outputs/project-a/' } },
      { sessionId: 'session-other', workArea: { relPath: 'outputs/project-b' } }
    ].map((expected) => expect.objectContaining({
      ...expected,
      workArea: expect.objectContaining(expected.workArea)
    }))))
  })

  it('records a running Claude task with workspace navigation context', async () => {
    const registry = await makeRegistry()

    const task = await registry.recordRunning({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Project Alpha',
      workspacePath: '/tmp/project-alpha',
      prompt: '请生成登录页',
      workArea: { kind: 'feature', relPath: 'features/login' }
    })

    expect(task).toMatchObject({
      id: 'session-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Project Alpha',
      status: 'running',
      title: '请生成登录页',
      workArea: { kind: 'feature', relPath: 'features/login' }
    })
    await expect(registry.list()).resolves.toHaveLength(1)
  })

  it('updates task status by session when a turn finishes', async () => {
    const registry = await makeRegistry()
    await registry.recordRunning({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Project Alpha',
      workspacePath: '/tmp/project-alpha',
      prompt: '请生成登录页',
      workArea: { kind: 'workspace' }
    })

    await registry.finishSession('session-1', {
      status: 'completed',
      changedArtifacts: ['features/login/index.html']
    })

    const [task] = await registry.list()
    expect(task.status).toBe('completed')
    expect(task.changedArtifacts).toEqual(['features/login/index.html'])
  })

  it('updates isolated tasks by session id even when task id is different', async () => {
    const registry = await makeRegistry()
    await registry.recordRunning({
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1::ai-task::task-1',
      workspaceName: 'Project Alpha / AI task',
      workspacePath: '/tmp/ai-task-worktree',
      baseWorkspaceId: 'workspace-1',
      baseWorkspaceName: 'Project Alpha',
      baseWorkspacePath: '/tmp/project-alpha',
      isolationBranch: 'ai/task-1',
      prompt: '请生成登录页',
      workArea: { kind: 'workspace' }
    })

    await registry.finishSession('session-1', {
      status: 'completed',
      changedArtifacts: ['features/login/index.html']
    })

    const [task] = await registry.list()
    expect(task.id).toBe('task-1')
    expect(task.sessionId).toBe('session-1')
    expect(task.status).toBe('completed')
    expect(task.workspaceId).toBe('workspace-1::ai-task::task-1')
    expect(task.baseWorkspaceId).toBe('workspace-1')
    expect(task.isolationBranch).toBe('ai/task-1')
  })

  it('marks a task as waiting for approval by session id', async () => {
    const registry = await makeRegistry()
    await registry.recordRunning({
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1::ai-task::task-1',
      workspaceName: 'Project Alpha / AI task',
      workspacePath: '/tmp/ai-task-worktree',
      prompt: '请生成登录页',
      workArea: { kind: 'workspace' }
    })

    await registry.markWaitingForApproval('session-1')

    const [task] = await registry.list()
    expect(task.status).toBe('waiting_approval')
  })

  it('records the latest AI output preview for a task session', async () => {
    const registry = await makeRegistry()
    await registry.recordRunning({
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1::ai-task::task-1',
      workspaceName: 'Project Alpha / AI task',
      workspacePath: '/tmp/ai-task-worktree',
      prompt: '请生成登录页',
      workArea: { kind: 'workspace' }
    })

    await registry.recordActivity('session-1', '已经完成主要布局，正在调整按钮状态和响应式间距。')

    const [task] = await registry.list()
    expect(task.lastMessagePreview).toBe('已经完成主要布局，正在调整按钮状态和响应式间距。')
  })

  it('marks an isolated task as aborted by task id', async () => {
    const registry = await makeRegistry()
    await registry.recordRunning({
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1::ai-task::task-1',
      workspaceName: 'Project Alpha / AI task',
      workspacePath: '/tmp/ai-task-worktree',
      prompt: '请生成登录页',
      workArea: { kind: 'workspace' }
    })

    await registry.markAborted('task-1')

    const [task] = await registry.list()
    expect(task.status).toBe('aborted')
  })
})
