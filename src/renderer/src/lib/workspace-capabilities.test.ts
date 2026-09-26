import { describe, expect, it } from 'vitest'
import type { GitCapability, Workspace } from '@shared/types'
import { shouldRequestWorkspaceGitStatus } from './workspace-capabilities'

const workspace = (input: Partial<Workspace> = {}): Workspace => ({
  id: 'w-1',
  kind: 'project',
  name: 'demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
  addedAt: '2026-07-18T00:00:00.000Z',
  lastActiveAt: '2026-07-18T00:00:00.000Z',
  ...input,
})

describe('workspace renderer capabilities', () => {
  it('skips Git status for an unbound simple project', () => {
    const capability: GitCapability = { state: 'unbound' }
    expect(shouldRequestWorkspaceGitStatus(
      workspace({ workflowMode: 'simple' }),
      capability,
    )).toBe(false)
  })

  it('requests Git status after a simple project is bound', () => {
    const capability: GitCapability = { state: 'local', branch: 'main' }
    expect(shouldRequestWorkspaceGitStatus(
      workspace({ workflowMode: 'simple' }),
      capability,
    )).toBe(true)
  })

  it('preserves Git status for legacy projects', () => {
    expect(shouldRequestWorkspaceGitStatus(workspace(), null)).toBe(true)
  })
})
