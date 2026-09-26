import type { AiTaskStatus, AiTaskSummary } from '@shared/types'

const STATUS_PRIORITY: Record<AiTaskStatus, number> = {
  waiting_approval: 0,
  waiting_user: 1,
  running: 2,
  completed: 3,
  applied: 3,
  failed: 4,
  aborted: 5
}

export function sortAiTasksForNotch(tasks: AiTaskSummary[]): AiTaskSummary[] {
  return [...tasks].sort((a, b) => {
    const priority = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
    if (priority !== 0) return priority
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function aiTaskNotchStatusLabel(status: AiTaskStatus): string {
  if (status === 'waiting_approval') return '需授权'
  if (status === 'waiting_user') return '需抉择'
  if (status === 'running') return '运行中'
  if (status === 'completed' || status === 'applied') return '已完成'
  if (status === 'failed') return '失败'
  return '已中止'
}

export function aiTaskCanAbort(task: AiTaskSummary): boolean {
  return task.status === 'running'
    || task.status === 'waiting_user'
    || task.status === 'waiting_approval'
}

export type AiTaskProjectAttribution = {
  primary: string
  secondary: string
}

export function aiTaskProjectAttribution(task: AiTaskSummary): AiTaskProjectAttribution {
  const rootProjectName = task.baseWorkspaceName ?? task.workspaceName
  if (task.workArea.kind === 'ui-product' || task.workArea.kind === 'feature') {
    const normalized = task.workArea.relPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const projectName = normalized.split('/').filter(Boolean).at(-1)
    if (projectName) {
      return {
        primary: projectName,
        secondary: `根项目 ${rootProjectName}`
      }
    }
  }
  return {
    primary: `根项目 ${rootProjectName}`,
    secondary: ''
  }
}
