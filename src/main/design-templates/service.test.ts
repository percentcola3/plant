import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DESIGN_TEMPLATES } from '@shared/design-templates'

const paths = vi.hoisted(() => ({ userData: '' }))
const scheduleIndex = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }))
vi.mock('../resource-index/service', () => ({ scheduleResourceIndexBuild: scheduleIndex }))

import { externalPoolStore, _testOnlyResetSharedCache } from '../external-pool/store'
import { copyDesignTemplate, designTemplateRootCandidates, ensureBuiltinDesignAssets, installDesignTemplate, readDesignTemplate } from './service'
import { scanUikitAssetSummary } from '../uikit/summary'

let directory: string
const initialResources = process.resourcesPath
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'plant-design-templates-'))
  paths.userData = join(directory, 'userData')
  await fs.mkdir(paths.userData, { recursive: true })
  await fs.writeFile(join(paths.userData, 'external-pool.json'), JSON.stringify({ externalRefs: [], schemaVersion: 1 }))
  _testOnlyResetSharedCache()
  scheduleIndex.mockClear()
})
afterEach(async () => {
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: initialResources })
  _testOnlyResetSharedCache()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('built-in design assets', () => {
  it('fills the resource pool once, preserving existing assets and deliberate removal across restarts', async () => {
    await externalPoolStore.add({ id: 'custom', alias: 'custom', kind: 'local', category: 'uikit', source: '/custom', poolPath: '/custom', addedAt: '2026-10-03' })
    await Promise.all([ensureBuiltinDesignAssets(), ensureBuiltinDesignAssets()])
    const refs = await externalPoolStore.list()
    expect(refs).toHaveLength(3)
    expect(refs.map(ref => ref.builtinTemplateId).filter(Boolean)).toEqual(['antd', 'heroui'])
    const antd = refs.find(ref => ref.builtinTemplateId === 'antd')!
    await externalPoolStore.remove(antd.id)
    _testOnlyResetSharedCache()
    await ensureBuiltinDesignAssets()
    expect(await externalPoolStore.list()).toHaveLength(2)
    expect(await externalPoolStore.findById(antd.id)).toBeNull()
  })

  it('provides native UI asset libraries with themes and working relative component dependencies', async () => {
    for (const template of DESIGN_TEMPLATES) {
      const ref = await installDesignTemplate(template.id)
      const summary = await scanUikitAssetSummary(ref.poolPath)
      expect(summary.warnings).toEqual([])
      expect(summary.assetLibraries).toHaveLength(1)
      expect(summary.componentsCount).toBe(1)
      const lib = summary.assetLibraries[0]
      expect(lib.theme?.palette.cssExists).toBe(true)
      expect(lib.theme?.variants.length).toBe(template.id === 'heroui' ? 2 : 1)
      const demo = lib.components[0].demoPath!
      const html = await fs.readFile(join(ref.poolPath, demo), 'utf8')
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        expect((await fs.stat(resolve(ref.poolPath, demo, '..', match[1]))).isFile()).toBe(true)
      }
    }
  })

  it('fills missing asset examples in earlier installed copies without overwriting customized files', async () => {
    const ref = await installDesignTemplate('antd')
    await fs.rm(join(ref.poolPath, 'components'), { recursive: true })
    await fs.writeFile(join(ref.poolPath, 'team-theme.css'), 'custom theme')
    await ensureBuiltinDesignAssets()
    expect((await scanUikitAssetSummary(ref.poolPath)).componentsCount).toBe(1)
    expect(await fs.readFile(join(ref.poolPath, 'team-theme.css'), 'utf8')).toBe('custom theme')
  })
  it('provides every advertised file, including authoring instructions and licenses', async () => {
    for (const template of DESIGN_TEMPLATES) {
      const files = await readDesignTemplate(template.id)
      expect(files.map(file => file.path)).toEqual(template.files.map(file => file.path))
      expect(files.every(file => file.content.length > 0)).toBe(true)
      expect(files.find(file => file.path === 'README.md')?.content).toContain('最小的 AI_USAGE.md 示例')
      expect(files.find(file => file.path === 'upstream/LICENSE')?.content).toBeTruthy()
    }
  })

  it('uses bundled templates before the repository in packaged builds', async () => {
    const resources = join(directory, 'Resources')
    await fs.cp(resolve('resources/design-templates/antd'), join(resources, 'design-templates/antd'), { recursive: true })
    await fs.writeFile(join(resources, 'design-templates/antd/README.md'), 'packaged template')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources })
    expect(designTemplateRootCandidates('/app/out/main', '/elsewhere', resources)[0]).toBe(join(resources, 'design-templates'))
    expect((await readDesignTemplate('antd'))[0].content).toBe('packaged template')
  })

  it('installs durable assets once, including simultaneous requests, without modifying the bundled source', async () => {
    const source = resolve('resources/design-templates/antd/README.md')
    const original = await fs.readFile(source, 'utf8')
    const [first, second] = await Promise.all([installDesignTemplate('antd'), installDesignTemplate('antd')])
    expect(first.id).toBe(second.id)
    expect(first).toMatchObject({ category: 'uikit', kind: 'local', builtinTemplateId: 'antd', instructionFile: 'AI_USAGE.md' })
    expect(first.poolPath).toBe(join(paths.userData, 'design-templates/antd'))
    expect((await externalPoolStore.list())).toHaveLength(1)
    expect(scheduleIndex).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(join(first.poolPath, 'README.md'), 'utf8')).toBe(original)
    await fs.writeFile(join(first.poolPath, 'README.md'), 'local customization')
    expect((await installDesignTemplate('antd')).id).toBe(first.id)
    expect(await fs.readFile(join(first.poolPath, 'README.md'), 'utf8')).toBe('local customization')
    expect(await fs.readFile(source, 'utf8')).toBe(original)
    _testOnlyResetSharedCache()
    expect((await installDesignTemplate('antd')).id).toBe(first.id)
  })

  it('preserves user-added resources with the suggested alias', async () => {
    await externalPoolStore.add({ id: 'custom', alias: 'heroui-design', kind: 'local', category: 'knowledge', source: '/custom', poolPath: '/custom', addedAt: '2026-10-03' })
    const ref = await installDesignTemplate('heroui')
    expect(ref.alias).toBe('heroui-design-2')
    expect((await externalPoolStore.findById('custom'))?.poolPath).toBe('/custom')
  })

  it('restores missing installed files while retaining the original resource identity', async () => {
    const ref = await installDesignTemplate('heroui')
    await fs.rm(ref.poolPath, { recursive: true })
    expect((await installDesignTemplate('heroui')).id).toBe(ref.id)
    expect(await fs.readFile(join(ref.poolPath, 'AI_USAGE.md'), 'utf8')).toContain('HeroUI')
    expect(scheduleIndex).toHaveBeenCalledTimes(2)
  })

  it('copies an editable template and refuses to overwrite the user copy', async () => {
    const result = await copyDesignTemplate('antd', directory)
    expect(result.path).toBe(join(directory, 'antd-design-template'))
    expect(await fs.readFile(join(result.path, 'team-theme.json'), 'utf8')).toContain('colorPrimary')
    expect(await fs.readFile(join(result.path, 'upstream/LICENSE'), 'utf8')).toContain('MIT')
    await fs.writeFile(join(result.path, 'AI_USAGE.md'), 'my own rules')
    await expect(copyDesignTemplate('antd', directory)).rejects.toMatchObject({ code: 'TARGET_EXISTS' })
    expect(await fs.readFile(join(result.path, 'AI_USAGE.md'), 'utf8')).toBe('my own rules')
  })

  it('rejects unknown templates and invalid copy destinations before writing any assets', async () => {
    await expect(readDesignTemplate('../antd')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(installDesignTemplate('unknown')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(copyDesignTemplate('heroui', 'relative')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(copyDesignTemplate('heroui', join(directory, 'missing'))).rejects.toMatchObject({ code: 'NOT_DIR' })
    expect(await externalPoolStore.list()).toEqual([])
    expect(await fs.stat(join(paths.userData, 'design-templates')).catch(() => null)).toBeNull()
  })
})
