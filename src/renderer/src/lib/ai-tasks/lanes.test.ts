import { describe, expect, it } from 'vitest'
import type { AiTaskSummary } from '@shared/types'
import { groupAiTasksByLane } from './lanes'

function task(id: string, status: AiTaskSummary['status']): AiTaskSummary {
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
    updatedAt: '2026-07-04T01:00:00.000Z',
    changedArtifacts: [],
    unread: false
  }
}

describe('groupAiTasksByLane', () => {
  it('groups running, waiting, and terminal tasks into stable lanes', () => {
    const lanes = groupAiTasksByLane([
      task('running', 'running'),
      task('waiting-user', 'waiting_user'),
      task('waiting-approval', 'waiting_approval'),
      task('completed', 'completed'),
      task('failed', 'failed'),
      task('aborted', 'aborted')
    ])

    expect(lanes.map((lane) => lane.id)).toEqual(['running', 'waiting', 'done'])
    expect(lanes.map((lane) => lane.tasks.map((item) => item.id))).toEqual([
      ['running'],
      ['waiting-user', 'waiting-approval'],
      ['completed', 'failed', 'aborted']
    ])
  })
})
