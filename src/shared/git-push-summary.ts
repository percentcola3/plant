export type GitPushFileSummary = {
  path: string
  previousPath?: string
  change: 'added' | 'modified' | 'deleted' | 'renamed' | 'other'
  summary: string
}

export type GitPushSummary = {
  version: 1
  id: string
  branch: string
  baseSha: string | null
  headSha: string
  pushedAt: string
  author: string
  source: 'ai' | 'basic'
  summary: string
  files: GitPushFileSummary[]
  filesTruncated: boolean
  diffTruncated: boolean
}

export type GitPushHistory = {
  records: GitPushSummary[]
  syncWarning?: string
  pendingSync: boolean
}
