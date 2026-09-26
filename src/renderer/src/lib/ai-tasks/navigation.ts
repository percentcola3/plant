import type { AiTaskSummary, WorkspaceKind } from '@shared/types'

export type AiTaskNavigation = {
  projectView: 'project-home' | 'features-page'
  uxNode?: 'home' | 'assets' | 'images' | 'outputs' | 'skills'
  openTerminal: boolean
}

export function resolveAiTaskNavigation(
  task: AiTaskSummary,
  workspaceKind: WorkspaceKind | undefined
): AiTaskNavigation {
  if (workspaceKind === 'ux') {
    if (task.workArea.kind === 'ui-product') {
      return { projectView: 'project-home', uxNode: 'outputs', openTerminal: true }
    }
    if (task.workArea.kind === 'ui-component') {
      return { projectView: 'project-home', uxNode: 'assets', openTerminal: true }
    }
    return { projectView: 'project-home', uxNode: 'home', openTerminal: true }
  }

  if (workspaceKind === 'project' && task.workArea.kind === 'feature') {
    return { projectView: 'features-page', openTerminal: true }
  }

  return { projectView: 'project-home', openTerminal: true }
}
