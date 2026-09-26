import type { GitCapability, Workspace } from '@shared/types'
import { isSimpleWorkspace } from '@shared/workspace-policy'

export function shouldRequestWorkspaceGitStatus(
  workspace: Pick<Workspace, 'workflowMode'>,
  capability: GitCapability | null,
): boolean {
  return !isSimpleWorkspace(workspace) || capability?.state !== 'unbound'
}
