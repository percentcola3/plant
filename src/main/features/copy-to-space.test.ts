import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'

const tmpUserData = await mkdtemp(join(tmpdir(), 'copy-to-space-userdata-'))

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

const gitApi = vi.hoisted(() => ({
  status: vi.fn(async () => ({ current: 'space/alice' })),
  branchLocal: vi.fn(async () => ({ all: ['main', 'space/alice', 'space/bob'], current: 'space/alice' })),
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  raw: vi.fn(async (_args: string[]) => '')
}))

vi.mock('../git/client', () => ({
  gitFor: vi.fn(() => gitApi)
}))

const storeMock = vi.hoisted(() => ({ findById: vi.fn() }))
vi.mock('../workspaces/store', () => ({
  WorkspacesStore: vi.fn(() => ({ findById: storeMock.findById }))
}))

import { copyFeatureToSpace } from './copy-to-space'

const baseWorkspace: Workspace = {
  id: 'ws-1',
  kind: 'project',
  name: 'demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
  addedAt: '2026-07-01T00:00:00.000Z',
  lastActiveAt: '2026-07-01T00:00:00.000Z'
}

let workspacePath: string
let targetWorkspacePath: string
let createdWorktreePath: string | null
let copiedBeforeCleanup = false
let renamedCopyBeforeCleanup = false

async function pathExists(path: string): Promise<boolean> {
  return fs.stat(path).then(() => true).catch(() => false)
}

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'copy-to-space-ws-'))
  targetWorkspacePath = await mkdtemp(join(tmpdir(), 'copy-to-space-target-ws-'))
  await fs.mkdir(join(workspacePath, 'features', 'pix', 'doc'), { recursive: true })
  await fs.writeFile(join(workspacePath, 'features', 'pix', 'doc', 'prd.md'), '# pix')
  storeMock.findById.mockReset()
  storeMock.findById.mockImplementation(async (id: string) => {
    if (id === 'ws-2') return { ...baseWorkspace, id: 'ws-2', path: targetWorkspacePath }
    return { ...baseWorkspace, path: workspacePath }
  })
  createdWorktreePath = null
  copiedBeforeCleanup = false
  renamedCopyBeforeCleanup = false
  gitApi.status.mockReset().mockResolvedValue({ current: 'space/alice' })
  gitApi.branchLocal.mockReset().mockResolvedValue({
    all: ['main', 'space/alice', 'space/bob'],
    current: 'space/alice'
  })
  gitApi.add.mockReset().mockResolvedValue(undefined)
  gitApi.commit.mockReset().mockResolvedValue(undefined)
  gitApi.raw.mockReset().mockImplementation(async (args: string[]) => {
    if (args[0] === 'for-each-ref') return ''
    if (args[0] === 'worktree' && args[1] === 'add') {
      createdWorktreePath = args[2]
      await fs.mkdir(createdWorktreePath, { recursive: true })
      return ''
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      copiedBeforeCleanup = await pathExists(join(args[3], 'features', 'pix', 'doc', 'prd.md'))
      renamedCopyBeforeCleanup = await pathExists(join(args[3], 'features', 'pix-copy', 'doc', 'prd.md'))
      return ''
    }
    return ''
  })
})

describe('copyFeatureToSpace', () => {
  it('copies a feature directory into the selected personal-space branch worktree', async () => {
    const result = await copyFeatureToSpace({
      workspaceId: 'ws-1',
      relPath: 'features/pix',
      targetSlug: 'bob'
    })

    expect(result).toMatchObject({
      relPath: 'features/pix',
      targetBranch: 'space/bob'
    })
    expect(gitApi.raw).toHaveBeenCalledWith([
      'worktree',
      'add',
      expect.any(String),
      'space/bob'
    ])
    expect(createdWorktreePath).toBeTruthy()
    expect(copiedBeforeCleanup).toBe(true)
    expect(gitApi.add).toHaveBeenCalledWith(['-A', 'features/pix'])
    expect(gitApi.commit).toHaveBeenCalledWith(expect.stringContaining('pix'))
    await expect(pathExists(join(createdWorktreePath!, 'features', 'pix'))).resolves.toBe(false)
  })

  it('copies a feature directory under a new leaf name when targetName is provided', async () => {
    const result = await copyFeatureToSpace({
      workspaceId: 'ws-1',
      relPath: 'features/pix',
      targetSlug: 'bob',
      targetName: 'pix-copy'
    })

    expect(result).toMatchObject({
      relPath: 'features/pix-copy',
      targetBranch: 'space/bob'
    })
    expect(renamedCopyBeforeCleanup).toBe(true)
    expect(gitApi.add).toHaveBeenCalledWith(['-A', 'features/pix-copy'])
    expect(gitApi.commit).toHaveBeenCalledWith(expect.stringContaining('pix-copy'))
  })

  it('copies a feature into another workspace repository without creating a worktree when target branch is checked out', async () => {
    gitApi.status.mockResolvedValue({ current: 'space/bob' })

    const result = await copyFeatureToSpace({
      workspaceId: 'ws-1',
      targetWorkspaceId: 'ws-2',
      relPath: 'features/pix',
      targetSlug: 'bob'
    })

    expect(result).toMatchObject({
      relPath: 'features/pix',
      targetWorkspaceId: 'ws-2',
      targetBranch: 'space/bob'
    })
    expect(await pathExists(join(targetWorkspacePath, 'features', 'pix', 'doc', 'prd.md'))).toBe(true)
    expect(gitApi.raw).not.toHaveBeenCalledWith([
      'worktree',
      'add',
      expect.any(String),
      'space/bob'
    ])
    expect(gitApi.add).toHaveBeenCalledWith(['-A', 'features/pix'])
  })

  it('rejects instead of overwriting when target branch already has the feature path', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'for-each-ref') return ''
      if (args[0] === 'worktree' && args[1] === 'add') {
        createdWorktreePath = args[2]
        await fs.mkdir(join(createdWorktreePath, 'features', 'pix'), { recursive: true })
        return ''
      }
      return ''
    })

    await expect(copyFeatureToSpace({
      workspaceId: 'ws-1',
      relPath: 'features/pix',
      targetSlug: 'bob'
    })).rejects.toMatchObject({ code: 'EXISTS' })
  })
})
