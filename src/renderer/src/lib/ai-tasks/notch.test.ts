import { describe, expect, it } from 'vitest'
import type { AiTaskSummary } from '@shared/types'
import {
  aiTaskCanAbort,
  aiTaskNotchStatusLabel,
  aiTaskProjectAttribution,
  sortAiTasksForNotch
} from './notch'

function task(id: string, status: AiTaskSummary['status'], updatedAt = '2026-07-04T01:00:00.000Z'): AiTaskSummary {
  return {
    id,
    sessionId: `session-${id}`,
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    workspacePath: '/tmp/workspace',
    status,
    title: id,
    promptPreview: id,
    workArea: { kind: 'workspace' },
    createdAt: '2026-07-04T01:00:00.000Z',
    updatedAt,
    changedArtifacts: [],
    unread: false
  }
}

describe('ai task notch helpers', () => {
  it('prioritizes tasks that need user attention over running and done tasks', () => {
    const sorted = sortAiTasksForNotch([
      task('done', 'completed', '2026-07-04T05:00:00.000Z'),
      task('running', 'running', '2026-07-04T04:00:00.000Z'),
      task('approval', 'waiting_approval', '2026-07-04T03:00:00.000Z'),
      task('question', 'waiting_user', '2026-07-04T02:00:00.000Z')
    ])

    expect(sorted.map((item) => item.id)).toEqual(['approval', 'question', 'running', 'done'])
  })

  it('uses compact status labels for the notch surface', () => {
    expect(aiTaskNotchStatusLabel('waiting_approval')).toBe('需授权')
    expect(aiTaskNotchStatusLabel('waiting_user')).toBe('需抉择')
    expect(aiTaskNotchStatusLabel('running')).toBe('运行中')
    expect(aiTaskNotchStatusLabel('completed')).toBe('已完成')
  })

  it('exposes action eligibility for abort control', () => {
    expect(aiTaskCanAbort(task('running', 'running'))).toBe(true)
    expect(aiTaskCanAbort(task('waiting', 'waiting_user'))).toBe(true)
    expect(aiTaskCanAbort(task('done', 'completed'))).toBe(false)
  })

  it('uses the internal project as primary attribution and the root project as context', () => {
    const item = task('project-task', 'running')
    item.workspaceName = 'Saas2'
    item.workArea = { kind: 'ui-product', relPath: 'outputs/12/c-order-management-v3/' }

    expect(aiTaskProjectAttribution(item)).toEqual({
      primary: 'c-order-management-v3',
      secondary: '根项目 Saas2'
    })
  })

  it('falls back to an explicit root-project label without internal project context', () => {
    const item = task('root-task', 'running')
    item.workspaceName = 'Saas2'

    expect(aiTaskProjectAttribution(item)).toEqual({
      primary: '根项目 Saas2',
      secondary: ''
    })
  })
})
