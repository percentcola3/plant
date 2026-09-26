import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
const openDialogMock = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData },
  dialog: { showOpenDialog: openDialogMock }
}))

import { importIcons } from './import'
import { WorkspacesStore, _testOnlyResetSharedCache } from '../workspaces/store'
import { workspacesJsonPath } from '../workspaces/paths'

let workspacePath: string
let sourcePath: string
let workspaceId: string

function workspace(input: Partial<Workspace> = {}): Workspace {
  return {
    id: workspaceId,
    kind: 'ux',
    name: 'uikit',
    path: workspacePath,
    defaultBranch: 'main',
    addedAt: '2026-06-11T00:00:00.000Z',
    lastActiveAt: '2026-06-11T00:00:00.000Z',
    ...input
  }
}

beforeEach(async () => {
  electronPaths.userData = await mkdtemp(join(tmpdir(), 'icons-import-userdata-'))
  _testOnlyResetSharedCache()
  openDialogMock.mockReset()
  await fs.rm(workspacesJsonPath(), { force: true })
  workspacePath = await mkdtemp(join(tmpdir(), 'icons-import-uikit-'))
  const sourceDir = await mkdtemp(join(tmpdir(), 'icons-import-source-'))
  sourcePath = join(sourceDir, 'raw-image.svg')
  workspaceId = `ux-${Math.random().toString(36).slice(2, 10)}`
  await fs.writeFile(sourcePath, '<svg />', 'utf-8')
  await new WorkspacesStore().add(workspace())
})

afterEach(async () => {
  _testOnlyResetSharedCache()
  await fs.rm(electronPaths.userData, { recursive: true, force: true }).catch(() => undefined)
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined)
})

describe('importIcons', () => {
  it('imports a named UX image into icons/custom and appends registry entries', async () => {
    await fs.mkdir(join(workspacePath, 'assets/icons/registry'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'assets/icons/registry/icon-registry.json'),
      JSON.stringify({ version: 1, entries: [] }, null, 2),
      'utf-8'
    )

    const result = await importIcons(workspaceId, [sourcePath], '搜索入口', 'Search')

    expect(result).toEqual({ added: ['Search.svg'], skipped: [] })
    await expect(fs.readFile(join(workspacePath, 'assets/icons/custom/Search.svg'), 'utf-8'))
      .resolves.toBe('<svg />')
    const registry = JSON.parse(
      await fs.readFile(join(workspacePath, 'assets/icons/registry/icon-registry.json'), 'utf-8')
    ) as { entries: Array<Record<string, unknown>> }
    expect(registry.entries).toEqual([
      expect.objectContaining({
        id: 'icon-search',
        type: 'icon',
        name: 'Search 搜索入口',
        path: 'icons/custom/Search.svg',
        designName: '搜索入口'
      })
    ])
  })

  it('rejects named UX image imports whose name is not letters only', async () => {
    await expect(importIcons(workspaceId, [sourcePath], '搜索入口', 'Search01'))
      .rejects.toMatchObject({ code: 'VALIDATION' })

    await expect(fs.stat(join(workspacePath, 'assets/icons/custom/Search01.svg')))
      .rejects.toBeTruthy()
  })
})
