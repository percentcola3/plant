import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

import { externalPoolStore, _testOnlyResetSharedCache as resetExternalPool } from '../external-pool/store'
import { indexFile } from '../external-pool/paths'
import { WorkspacesStore, _testOnlyResetSharedCache as resetWorkspaces } from './store'
import { workspacesJsonPath } from './paths'
import { writeRefs } from './refs'
import { searchWorkspaceText } from './search'

let workspacePath: string
let workspaceId: string

function workspace(input: Partial<Workspace> = {}): Workspace {
  return {
    id: workspaceId,
    kind: 'project',
    name: 'demo',
    path: workspacePath,
    defaultBranch: 'main',
    addedAt: '2026-06-11T00:00:00.000Z',
    lastActiveAt: '2026-06-11T00:00:00.000Z',
    ...input
  }
}

async function writeFile(relPath: string, content: string): Promise<void> {
  const abs = join(workspacePath, relPath)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
}

beforeEach(async () => {
  electronPaths.userData = await mkdtemp(join(tmpdir(), 'workspace-search-userdata-'))
  resetWorkspaces()
  resetExternalPool()
  await fs.rm(workspacesJsonPath(), { force: true })
  await fs.rm(indexFile(), { force: true })
  workspacePath = await mkdtemp(join(tmpdir(), 'workspace-search-'))
  workspaceId = `ws-${Math.random().toString(36).slice(2, 10)}`
})

describe.sequential('searchWorkspaceText', () => {
  it('searches project text files and skips private or generated directories', async () => {
    await new WorkspacesStore().add(workspace())
    await writeFile('docs/prd.md', '支付流程需要灰度发布\n')
    await writeFile('notes.txt', '灰度观察项\n')
    await writeFile('.ui-client/private.md', '灰度 private\n')
    await writeFile('.external/kb/hidden.md', '灰度 external link\n')
    await writeFile('node_modules/pkg/readme.md', '灰度 dependency\n')
    await writeFile('dist/report.md', '灰度 built output\n')

    const result = await searchWorkspaceText(workspaceId, '灰度')

    expect(result.query).toBe('灰度')
    expect(result.results.map((item) => item.relPath)).toEqual([
      'docs/prd.md',
      'notes.txt'
    ])
    expect(result.results[0]).toMatchObject({
      source: 'workspace',
      title: 'prd.md',
      engine: 'legacy'
    })
    expect(result.trace.legacyRoots).toBeGreaterThan(0)
    expect(result.trace.zgRoots).toBe(0)
    expect(result.results[0].snippet).toContain('支付流程')
  })

  it('searches attached knowledge refs and ignores UI asset refs', async () => {
    await new WorkspacesStore().add(workspace())
    const kbPath = await mkdtemp(join(tmpdir(), 'workspace-search-kb-'))
    const uiPath = await mkdtemp(join(tmpdir(), 'workspace-search-ui-'))
    await fs.writeFile(join(kbPath, 'guide.md'), '灰度策略说明\n', 'utf-8')
    await fs.writeFile(join(uiPath, 'theme.md'), '灰度 theme should not match\n', 'utf-8')
    await externalPoolStore.add({
      id: 'kb-1',
      alias: '产品知识',
      category: 'knowledge',
      kind: 'local',
      source: kbPath,
      poolPath: kbPath,
      addedAt: '2026-06-11T00:00:00.000Z'
    })
    await externalPoolStore.add({
      id: 'ui-1',
      alias: 'UI资产',
      category: 'uikit',
      kind: 'local',
      source: uiPath,
      poolPath: uiPath,
      addedAt: '2026-06-11T00:00:00.000Z'
    })
    await writeRefs(workspacePath, [
      { alias: '产品知识', externalRefId: 'kb-1', addedAt: '2026-06-11T00:00:00.000Z' },
      { alias: 'UI资产', externalRefId: 'ui-1', addedAt: '2026-06-11T00:00:00.000Z' }
    ])

    const result = await searchWorkspaceText(workspaceId, '灰度')

    expect(result.results).toEqual([
      expect.objectContaining({
        source: 'external',
        externalRefId: 'kb-1',
        externalAlias: '产品知识',
        relPath: 'guide.md'
      })
    ])
  })

  it('limits attached knowledge search to visibleDirs from the project binding', async () => {
    await new WorkspacesStore().add(workspace())
    const kbPath = await mkdtemp(join(tmpdir(), 'workspace-search-filtered-kb-'))
    await fs.mkdir(join(kbPath, 'docs'), { recursive: true })
    await fs.mkdir(join(kbPath, 'archive'), { recursive: true })
    await fs.writeFile(join(kbPath, 'docs/guide.md'), '灰度策略说明\n', 'utf-8')
    await fs.writeFile(join(kbPath, 'archive/old.md'), '灰度旧资料不应该出现\n', 'utf-8')
    await externalPoolStore.add({
      id: 'kb-filtered',
      alias: '筛选知识',
      category: 'knowledge',
      kind: 'local',
      source: kbPath,
      poolPath: kbPath,
      addedAt: '2026-06-11T00:00:00.000Z'
    })
    await writeRefs(workspacePath, [
      {
        alias: '筛选知识',
        externalRefId: 'kb-filtered',
        addedAt: '2026-06-11T00:00:00.000Z',
        visibleDirs: ['docs']
      }
    ])

    const result = await searchWorkspaceText(workspaceId, '灰度')

    expect(result.results.map((item) => item.relPath)).toEqual(['docs/guide.md'])
  })

  it('rejects non-project workspaces', async () => {
    await new WorkspacesStore().add(workspace({ kind: 'ux' }))

    await expect(searchWorkspaceText(workspaceId, '灰度'))
      .rejects.toMatchObject({ code: 'VALIDATION' })
  })
})
