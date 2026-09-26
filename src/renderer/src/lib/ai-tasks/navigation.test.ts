import { describe, expect, it } from 'vitest'
import type { AiTaskSummary, WorkspaceKind } from '@shared/types'
import { resolveAiTaskNavigation } from './navigation'

function task(workArea: AiTaskSummary['workArea']): AiTaskSummary {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    workspacePath: '/tmp/workspace',
    status: 'running',
    title: 'Task',
    promptPreview: 'Task',
    workArea,
    createdAt: '2026-07-04T01:00:00.000Z',
    updatedAt: '2026-07-04T01:00:00.000Z',
    changedArtifacts: [],
    unread: false
  }
}

describe('resolveAiTaskNavigation', () => {
  it('opens project feature tasks on the features page', () => {
    expect(resolveAiTaskNavigation(task({ kind: 'feature', relPath: 'features/login' }), 'project')).toEqual({
      projectView: 'features-page',
      uxNode: undefined,
      openTerminal: true
    })
  })

  it('opens UX product tasks on the outputs node', () => {
    expect(resolveAiTaskNavigation(task({ kind: 'ui-product', relPath: 'outputs/login' }), 'ux')).toEqual({
      projectView: 'project-home',
      uxNode: 'outputs',
      openTerminal: true
    })
  })

  it('falls back to project home for workspace-level tasks', () => {
    expect(resolveAiTaskNavigation(task({ kind: 'workspace' }), 'project' satisfies WorkspaceKind)).toEqual({
      projectView: 'project-home',
      uxNode: undefined,
      openTerminal: true
    })
  })
})
