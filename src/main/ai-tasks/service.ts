import { join } from 'node:path'
import { app } from 'electron'
import type { AiTaskStatus, AiTaskSummary, AiTaskWorkArea } from '@shared/types'
import { AiTaskStore } from './store'

type Clock = () => Date

export type RecordRunningTaskInput = {
  taskId?: string
  sessionId: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  baseWorkspaceId?: string
  baseWorkspaceName?: string
  baseWorkspacePath?: string
  isolationBranch?: string
  prompt: string
  workArea: AiTaskWorkArea
}

export type FinishTaskInput = {
  status: Extract<AiTaskStatus, 'completed' | 'failed' | 'aborted'>
  changedArtifacts?: string[]
  errorMessage?: string
}

function summarizePrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/).find(Boolean) ?? 'AI 任务'
  return firstLine.length > 32 ? `${firstLine.slice(0, 29)}...` : firstLine
}

function previewPrompt(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, ' ')
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}

function previewActivity(text: string): string {
  const compact = text.trim().replace(/\s+/g, ' ')
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact
}

function normalizeWorkAreaPath(workArea: AiTaskWorkArea): string {
  if (!workArea.relPath) return ''
  return workArea.relPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
}

function taskScopeKey(task: Pick<AiTaskSummary, 'workspaceId' | 'baseWorkspaceId' | 'workArea'>): string {
  const workspaceId = task.baseWorkspaceId ?? task.workspaceId
  return `${workspaceId}\0${task.workArea.kind}\0${normalizeWorkAreaPath(task.workArea)}`
}

export class AiTaskRegistry {
  constructor(
    private readonly store: AiTaskStore,
    private readonly now: Clock = () => new Date()
  ) {}

  async list(): Promise<AiTaskSummary[]> {
    const tasks = await this.store.list()
    const seenScopes = new Set<string>()
    return tasks.filter((task) => {
      const scope = taskScopeKey(task)
      if (seenScopes.has(scope)) return false
      seenScopes.add(scope)
      return true
    })
  }

  async get(id: string): Promise<AiTaskSummary | null> {
    return this.store.get(id)
  }

  async getBySessionId(sessionId: string): Promise<AiTaskSummary | null> {
    return this.store.getBySessionId(sessionId)
  }

  async recordRunning(input: RecordRunningTaskInput): Promise<AiTaskSummary> {
    return (await this.recordRunningReplacingScope(input)).task
  }

  async recordRunningReplacingScope(
    input: RecordRunningTaskInput
  ): Promise<{ task: AiTaskSummary; replaced: AiTaskSummary[] }> {
    const taskId = input.taskId ?? input.sessionId
    const existing = await this.store.get(taskId) ?? await this.store.getBySessionId(input.sessionId)
    const nowIso = this.now().toISOString()
    const task: AiTaskSummary = {
      id: taskId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      workspacePath: input.workspacePath,
      baseWorkspaceId: input.baseWorkspaceId ?? existing?.baseWorkspaceId,
      baseWorkspaceName: input.baseWorkspaceName ?? existing?.baseWorkspaceName,
      baseWorkspacePath: input.baseWorkspacePath ?? existing?.baseWorkspacePath,
      isolationBranch: input.isolationBranch ?? existing?.isolationBranch,
      status: 'running',
      title: existing?.title ?? summarizePrompt(input.prompt),
      promptPreview: previewPrompt(input.prompt),
      workArea: input.workArea,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      lastEventAt: nowIso,
      changedArtifacts: existing?.changedArtifacts ?? [],
      unread: existing?.unread ?? false
    }
    const scope = taskScopeKey(task)
    const replaced = await this.store.replaceWhere(task, (item) => taskScopeKey(item) === scope)
    return { task, replaced }
  }

  async markWaitingForUser(sessionId: string): Promise<void> {
    await this.patch(sessionId, { status: 'waiting_user' })
  }

  async markWaitingForApproval(sessionId: string): Promise<void> {
    await this.patch(sessionId, { status: 'waiting_approval' })
  }

  async finishSession(sessionId: string, input: FinishTaskInput): Promise<void> {
    await this.patch(sessionId, {
      status: input.status,
      changedArtifacts: input.changedArtifacts ?? [],
      errorMessage: input.errorMessage
    })
  }

  async markAborted(taskId: string): Promise<void> {
    await this.patch(taskId, { status: 'aborted' })
  }

  async dismiss(taskId: string): Promise<boolean> {
    return this.store.remove(taskId)
  }

  async recordActivity(sessionId: string, text: string): Promise<void> {
    const preview = previewActivity(text)
    if (!preview) return
    await this.patch(sessionId, { lastMessagePreview: preview })
  }

  private async patch(
    id: string,
    patch: Pick<Partial<AiTaskSummary>, 'status' | 'changedArtifacts' | 'errorMessage' | 'lastMessagePreview'>
  ): Promise<void> {
    const task = await this.store.get(id) ?? await this.store.getBySessionId(id)
    if (!task) return
    const nowIso = this.now().toISOString()
    await this.store.upsert({
      ...task,
      ...patch,
      updatedAt: nowIso,
      lastEventAt: nowIso
    })
  }
}

let sharedRegistry: AiTaskRegistry | null = null

export function aiTaskStorePath(userDataPath: string): string {
  return join(userDataPath, 'ai-tasks', 'tasks.json')
}

export function getSharedAiTaskRegistry(): AiTaskRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new AiTaskRegistry(new AiTaskStore(aiTaskStorePath(app.getPath('userData'))))
  }
  return sharedRegistry
}

export function _testOnlyResetAiTaskRegistry(): void {
  sharedRegistry = null
}
