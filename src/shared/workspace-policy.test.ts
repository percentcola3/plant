import { describe, expect, it } from 'vitest'
import type { Workspace } from './types'
import {
  isSimpleWorkspace,
  supportsGitFeatures,
  supportsPersonalSpaces,
} from './workspace-policy'

function workspace(input: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1',
    kind: 'project',
    name: 'demo',
    path: '/tmp/demo',
    defaultBranch: 'main',
    addedAt: '2026-07-18T00:00:00.000Z',
    lastActiveAt: '2026-07-18T00:00:00.000Z',
    ...input,
  }
}

describe('workspace workflow policy', () => {
  it('recognizes the explicit simple workflow', () => {
    expect(isSimpleWorkspace(workspace({ workflowMode: 'simple' }))).toBe(true)
    expect(isSimpleWorkspace(workspace())).toBe(false)
  })

  it('keeps personal spaces only for legacy project and UX workspaces', () => {
    expect(supportsPersonalSpaces(workspace({ workflowMode: 'simple' }))).toBe(false)
    expect(supportsPersonalSpaces(workspace())).toBe(true)
    expect(supportsPersonalSpaces(workspace({ kind: 'ux' }))).toBe(true)
    expect(supportsPersonalSpaces(workspace({ kind: 'knowledge' }))).toBe(false)
  })

  it('allows Git features for legacy workspaces and bound simple projects', () => {
    expect(supportsGitFeatures(workspace(), true)).toBe(true)
    expect(supportsGitFeatures(workspace({ workflowMode: 'simple' }), false)).toBe(false)
    expect(supportsGitFeatures(workspace({ workflowMode: 'simple' }), true)).toBe(true)
  })
})
