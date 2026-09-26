export type WorkspaceGitSummaryInput = {
  branch: string
  defaultBranch?: string
  hasRemote: boolean
  ahead: number
  modifiedCount: number
  behind: number
}

export type WorkspaceGitSummary = {
  branchLabel: string
  remoteLabel: string
}

export function formatWorkspaceGitSummary(input: WorkspaceGitSummaryInput): WorkspaceGitSummary {
  const branch = input.branch || input.defaultBranch || 'unknown'
  const isMainBranch = !!input.defaultBranch && branch === input.defaultBranch
  const outgoingCount = Math.max(input.ahead, 0) + Math.max(input.modifiedCount, 0)
  const incomingCount = Math.max(input.behind, 0)
  return {
    branchLabel: `${isMainBranch ? '公共空间' : '分支'} ${branch}`,
    remoteLabel: input.hasRemote ? `云端 ↑ ${outgoingCount} · ↓ ${incomingCount}` : '本地分支'
  }
}
