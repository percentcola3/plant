import { describe, expect, it } from 'vitest'
import * as personalSpace from './personal-space'

type WorktreeParser = (porcelain: string, branch: string) => string | null

describe('personal space worktree resolution', () => {
  it('finds the existing worktree that owns a branch', () => {
    const parser = (personalSpace as unknown as { findWorktreePathForBranch?: WorktreeParser })
      .findWorktreePathForBranch

    expect(typeof parser).toBe('function')

    const porcelain = [
      'worktree /tmp/repo-main',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /tmp/repo-alice',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/space/alice',
      ''
    ].join('\n')

    expect(parser!(porcelain, 'space/alice')).toBe('/tmp/repo-alice')
    expect(parser!(porcelain, 'main')).toBe('/tmp/repo-main')
    expect(parser!(porcelain, 'space/missing')).toBeNull()
  })
})
