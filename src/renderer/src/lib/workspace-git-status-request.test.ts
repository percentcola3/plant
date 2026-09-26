import { describe, expect, it } from 'vitest'
import { shouldApplyWorkspaceGitStatusResult } from './workspace-git-status-request'

describe('workspace git status request guard', () => {
  it('accepts the latest response for the active workspace', () => {
    expect(shouldApplyWorkspaceGitStatusResult({
      workspaceId: 'saasc',
      activeWorkspaceId: 'saasc',
      requestSeq: 2,
      latestSeq: 2
    })).toBe(true)
  })

  it('rejects a response from a workspace that is no longer active', () => {
    expect(shouldApplyWorkspaceGitStatusResult({
      workspaceId: 'saab',
      activeWorkspaceId: 'saasc',
      requestSeq: 1,
      latestSeq: 1
    })).toBe(false)
  })

  it('rejects an older response for the same workspace', () => {
    expect(shouldApplyWorkspaceGitStatusResult({
      workspaceId: 'saasc',
      activeWorkspaceId: 'saasc',
      requestSeq: 1,
      latestSeq: 2
    })).toBe(false)
  })
})
