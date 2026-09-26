import type { GitFailure } from '../git/failures'
import type { GitSnapshot } from '@shared/types'

// P0 仅迁 save / sync。P1 加 create-requirement / switch-requirement / complete-requirement / revert-to / rehydrate-externals。
export type SagaIntent = 'save' | 'sync'

export type SagaTrigger =
  | 'user'
  | 'auto-save'
  | 'before-quit'
  | 'startup-resume'
  | 'fs-change'
  | 'focus'
  | 'timer'

export type SagaStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type SagaStep = {
  op: string                                  // GitOp.name
  args: Record<string, unknown>
  status: SagaStepStatus
  attempts: number
  failure?: GitFailure
  startedAt?: string
  finishedAt?: string
}

export type SagaStatus =
  | 'running'
  | 'paused-for-user'                          // 等待 UI 介入（提示词复制 / AI handoff）
  | 'paused-for-ai'                            // P1 用：AI 正在处理
  | 'done'
  | 'failed'
  | 'corrupted'                                // journal 自身坏掉

export type SagaJournal = {
  id: string                                   // `${intent}-${ulid}`
  intent: SagaIntent
  workspaceId: string
  workspacePath: string                        // 反向查 ws 用，避免 store 依赖
  defaultBranch: string
  trigger: SagaTrigger
  args: Record<string, unknown>
  steps: SagaStep[]
  currentStep: number
  status: SagaStatus
  snapshotBefore?: GitSnapshot                 // saga 启动时的快照
  snapshotAfter?: GitSnapshot                  // 最近一次步骤后的快照
  createdAt: string
  lastTouchedAt: string
  schemaVersion: 1
}

// saga 定义：意图 + 步骤模板。runner 按这个铺到 journal.steps。
export type SagaDefinition = {
  intent: SagaIntent
  buildSteps: (args: Record<string, unknown>, snapshot: GitSnapshot) => SagaStep[]
}
