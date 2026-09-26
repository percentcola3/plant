import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'
import { scanWorkspace } from './scanner'

const gitState = vi.hoisted(() => ({
  branches: [] as string[],
  files: new Map<string, string>()
}))

const externalManifestState = vi.hoisted(() => ({
  refs: [] as Array<{
    alias: string
    category: 'knowledge' | 'uikit'
    kind: 'git'
    url: string
    readonly?: boolean
  }>
}))

const hydrateExternalManifestMock = vi.hoisted(() =>
  vi.fn(async () => ({ mounted: [], warnings: [] }))
)

const readPersonalSpaceByPathMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('../git/client', () => ({
  gitFor: () => ({
    branchLocal: async () => ({ all: gitState.branches }),
    show: async ([spec]: string[]) => {
      const text = gitState.files.get(spec)
      if (text === undefined) throw new Error(`missing ${spec}`)
      return text
    }
  })
}))

vi.mock('../external-pool/service', () => ({
  hydrateExternalManifest: hydrateExternalManifestMock
}))

vi.mock('./personal-space', () => ({
  readPersonalSpaceByPath: readPersonalSpaceByPathMock,
}))

vi.mock('./external-manifest', () => ({
  readExternalManifest: vi.fn(async () => ({
    schemaVersion: 1,
    refs: externalManifestState.refs
  }))
}))

let dir: string

async function touch(rel: string, content = ''): Promise<void> {
  const abs = join(dir, rel)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content)
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  await touch(rel, JSON.stringify(value, null, 2))
}

function ws(kind: Workspace['kind']): Workspace {
  return {
    id: 'wid',
    kind,
    name: 'test',
    path: dir,
    defaultBranch: 'main',
    addedAt: '2026-06-09T00:00:00.000Z',
    lastActiveAt: '2026-06-09T00:00:00.000Z'
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'workspace-scan-'))
  gitState.branches = []
  gitState.files.clear()
  externalManifestState.refs = []
  hydrateExternalManifestMock.mockClear()
  readPersonalSpaceByPathMock.mockClear()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('scanWorkspace - project kind', () => {
  it('simple 项目不读取 personal space', async () => {
    const r = await scanWorkspace({ ...ws('project'), workflowMode: 'simple' })

    if (r.kind !== 'project') throw new Error('expected project')
    expect(r.personalSpace).toBeNull()
    expect(readPersonalSpaceByPathMock).not.toHaveBeenCalled()
  })

  it('返回空 features + 空 refs 当目录干净', async () => {
    const r = await scanWorkspace(ws('project'))
    if (r.kind !== 'project') throw new Error('expected project')
    expect(r.features).toEqual([])
    expect(r.refs).toEqual([])
    expect(r.hasKnowledgeDir).toBe(false)
    expect(r.warnings).toEqual([])
  })

  it('hasKnowledgeDir 反映 .knowledge/ 是否存在', async () => {
    await fs.mkdir(join(dir, '.knowledge'), { recursive: true })
    const r = await scanWorkspace(ws('project'))
    if (r.kind !== 'project') throw new Error('expected project')
    expect(r.hasKnowledgeDir).toBe(true)
  })

  it('refs 从 .ui-client/refs.json 读', async () => {
    await writeJson('.ui-client/refs.json', [
      { alias: 'saas-uikit', externalRefId: 'kb01', addedAt: '2026-06-09T00:00:00.000Z' }
    ])
    const r = await scanWorkspace(ws('project'))
    if (r.kind !== 'project') throw new Error('expected project')
    expect(r.refs).toHaveLength(1)
    expect(r.refs[0].alias).toBe('saas-uikit')
  })

  it('扫描只提示未初始化外联，不自动 hydrate 外部依赖', async () => {
    externalManifestState.refs = [
      {
        alias: 'shared-kb',
        category: 'knowledge',
        kind: 'git',
        url: 'https://example.com/shared-kb.git',
        readonly: true
      }
    ]

    const r = await scanWorkspace(ws('project'))

    if (r.kind !== 'project') throw new Error('expected project')
    expect(hydrateExternalManifestMock).not.toHaveBeenCalled()
    expect(r.warnings.some((item) =>
      item.includes('外部依赖')
      && item.includes('shared-kb')
      && item.includes('更新外联')
    )).toBe(true)
  })
})

describe('scanWorkspace - asset kind', () => {
  it('空目录 → warnings 含 components/assets 缺失提示', async () => {
    const r = await scanWorkspace(ws('asset'))
    if (r.kind !== 'asset') throw new Error('expected asset')
    expect(r.assetLibraries).toEqual([])
    expect(r.hasComponentsDir).toBe(false)
    expect(r.hasAssetsDir).toBe(false)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('扫 components/<lib>/{theme/, 组件} 作为独立资产库', async () => {
    await touch('components/SaaS-B/theme/palette.css')
    await touch('components/SaaS-B/theme/theme-light.css')
    await touch('components/SaaS-B/theme/theme-dark.css')
    await touch('components/SaaS-B/sp-button/index.html')
    await touch('components/SaaS-C/theme/palette.css')
    await touch('components/SaaS-C/theme/theme-default.css')
    await touch('components/SaaS-C/sp-list/index.html')
    await fs.mkdir(join(dir, 'assets'), { recursive: true })

    const r = await scanWorkspace(ws('asset'))
    if (r.kind !== 'asset') throw new Error('expected asset')
    expect(r.assetLibraries).toHaveLength(2)
    expect(r.assetLibraries.map((lib) => lib.name)).toEqual(['SaaS-B', 'SaaS-C'])
    expect(r.assetLibraries[0].theme?.variants.map((v) => v.name)).toEqual(['dark', 'light'])
    expect(r.assetLibraries[0].components.map((c) => c.name)).toEqual(['sp-button'])
    expect(r.assetLibraries[0].components[0].hasDemo).toBe(true)
    expect(r.hasComponentsDir).toBe(true)
  })

  it('无 theme/ 的二级目录也算资产库（business/）', async () => {
    await touch('components/business/sp-order-form/index.html')
    const r = await scanWorkspace(ws('asset'))
    if (r.kind !== 'asset') throw new Error('expected asset')
    expect(r.assetLibraries).toHaveLength(1)
    expect(r.assetLibraries[0].name).toBe('business')
    expect(r.assetLibraries[0].theme).toBeNull()
    expect(r.assetLibraries[0].components.map((c) => c.name)).toEqual(['sp-order-form'])
  })

  it('识别 design-systems/<name> 作为轻量设计风格资产', async () => {
    await touch('design-systems/linear/DESIGN.md', '# Linear\n')
    await touch('design-systems/linear/tokens.css', ':root { --accent: #111; }\n')
    await touch('design-systems/linear/notes/voice.md', '# Voice\n')
    await touch('design-systems/linear/preview.css', '.demo { color: var(--accent); }\n')

    const r = await scanWorkspace(ws('asset'))

    if (r.kind !== 'asset') throw new Error('expected asset')
    expect(r.hasDesignSystemsDir).toBe(true)
    expect(r.designSystemAssets).toHaveLength(1)
    expect(r.designSystemAssets[0]).toEqual({
      name: 'linear',
      path: 'design-systems/linear',
      designPath: 'design-systems/linear/DESIGN.md',
      primaryCssPath: 'design-systems/linear/tokens.css',
      markdownPaths: [
        'design-systems/linear/DESIGN.md',
        'design-systems/linear/notes/voice.md'
      ],
      cssPaths: [
        'design-systems/linear/preview.css',
        'design-systems/linear/tokens.css'
      ]
    })
    expect(r.warnings).not.toContain('缺少 components/ 目录')
  })
})

describe('scanWorkspace - ux kind', () => {
  it('复用资产库扫描并识别 outputs 目录', async () => {
    await touch('components/SaaS-B/theme/palette.css')
    await touch('components/SaaS-B/theme/theme-light.css')
    await fs.mkdir(join(dir, 'assets'), { recursive: true })
    await touch('outputs/login/index.html')

    const r = await scanWorkspace(ws('ux'))

    if (r.kind !== 'ux') throw new Error('expected ux')
    expect(r.assetLibraries).toHaveLength(1)
    expect(r.assetLibraries[0].name).toBe('SaaS-B')
    expect(r.hasComponentsDir).toBe(true)
    expect(r.hasOutputsDir).toBe(true)
  })

  it('UX 工作区可以只有设计风格资产，不要求先建组件资产', async () => {
    await touch('design-systems/kami/DESIGN.md', '# Kami\n')

    const r = await scanWorkspace(ws('ux'))

    if (r.kind !== 'ux') throw new Error('expected ux')
    expect(r.assetLibraries).toEqual([])
    expect(r.designSystemAssets.map((asset) => asset.name)).toEqual(['kami'])
    expect(r.warnings).not.toContain('缺少 components/ 目录')
  })
})

describe('scanWorkspace - knowledge kind', () => {
  it('空目录 → 空树', async () => {
    const r = await scanWorkspace(ws('knowledge'))
    if (r.kind !== 'knowledge') throw new Error('expected knowledge')
    expect(r.tree).toEqual([])
  })

  it('递归扫描 md 文件', async () => {
    await touch('top.md', '# Top')
    await touch('sub/inner.md', '# Inner')
    await touch('skip.png', '') // 非 md 跳过
    await fs.mkdir(join(dir, '.hidden'), { recursive: true })
    await touch('.hidden/should-skip.md', '')
    const r = await scanWorkspace(ws('knowledge'))
    if (r.kind !== 'knowledge') throw new Error('expected knowledge')
    const names = JSON.stringify(r.tree)
    expect(names).toContain('top.md')
    expect(names).toContain('inner.md')
    expect(names).not.toContain('skip.png')
    expect(names).not.toContain('should-skip.md')
  })
})

describe('scanWorkspace - 异常', () => {
  it('目录不存在抛 WORKSPACE_DIR_MISSING', async () => {
    await expect(
      scanWorkspace({ ...ws('project'), path: join(dir, 'nonexistent') })
    ).rejects.toMatchObject({ code: 'WORKSPACE_DIR_MISSING' })
  })
})
