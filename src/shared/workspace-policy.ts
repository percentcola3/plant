import type { Workspace } from './types'

type WorkspaceWorkflow = Pick<Workspace, 'kind' | 'workflowMode'>

export function isSimpleWorkspace(workspace: Pick<Workspace, 'workflowMode'>): boolean {
  return workspace.workflowMode === 'simple'
}

export function supportsPersonalSpaces(workspace: WorkspaceWorkflow): boolean {
  return !isSimpleWorkspace(workspace)
    && (workspace.kind === 'project' || workspace.kind === 'ux')
}

export function supportsGitFeatures(
  workspace: Pick<Workspace, 'workflowMode'>,
  hasGitRepository: boolean,
): boolean {
  return !isSimpleWorkspace(workspace) || hasGitRepository
}
