type GitStatusRequestGuardInput = {
  workspaceId: string
  activeWorkspaceId: string | null | undefined
  requestSeq: number
  latestSeq: number
}

export function shouldApplyWorkspaceGitStatusResult(input: GitStatusRequestGuardInput): boolean {
  return input.workspaceId === input.activeWorkspaceId && input.requestSeq === input.latestSeq
}
