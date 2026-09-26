import { describe, expect, it } from 'vitest'
import { formatWorkspaceGitSummary } from './workspace-git-summary'

describe('formatWorkspaceGitSummary', () => {
  it('labels the default branch as main branch and includes remote counters', () => {
    expect(formatWorkspaceGitSummary({
      branch: 'main',
      defaultBranch: 'main',
      hasRemote: true,
      ahead: 2,
      modifiedCount: 0,
      behind: 0
    })).toEqual({
      branchLabel: '公共空间 main',
      remoteLabel: '云端 ↑ 2 · ↓ 0'
    })
  })

  it('labels non-default branches separately', () => {
    expect(formatWorkspaceGitSummary({
      branch: 'req/01H-login',
      defaultBranch: 'main',
      hasRemote: true,
      ahead: 0,
      modifiedCount: 0,
      behind: 3
    })).toEqual({
      branchLabel: '分支 req/01H-login',
      remoteLabel: '云端 ↑ 0 · ↓ 3'
    })
  })

  it('counts uncommitted changes as outgoing remote sync items', () => {
    expect(formatWorkspaceGitSummary({
      branch: 'req/01H-login',
      defaultBranch: 'main',
      hasRemote: true,
      ahead: 1,
      modifiedCount: 2,
      behind: 0
    })).toEqual({
      branchLabel: '分支 req/01H-login',
      remoteLabel: '云端 ↑ 3 · ↓ 0'
    })
  })

  it('shows local uncommitted changes even when there are no ahead commits', () => {
    expect(formatWorkspaceGitSummary({
      branch: 'req/01H-login',
      defaultBranch: 'main',
      hasRemote: true,
      ahead: 0,
      modifiedCount: 2,
      behind: 0
    })).toEqual({
      branchLabel: '分支 req/01H-login',
      remoteLabel: '云端 ↑ 2 · ↓ 0'
    })
  })

  it('shows local-only status without remote counters', () => {
    expect(formatWorkspaceGitSummary({
      branch: 'main',
      defaultBranch: 'main',
      hasRemote: false,
      ahead: 0,
      modifiedCount: 2,
      behind: 0
    })).toEqual({
      branchLabel: '公共空间 main',
      remoteLabel: '本地分支'
    })
  })
})
