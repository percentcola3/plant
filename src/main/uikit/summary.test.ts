import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanUikitAssetSummary } from './summary'

let dir: string

async function touch(rel: string, content = ''): Promise<void> {
  const abs = join(dir, rel)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uikit-summary-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('scanUikitAssetSummary', () => {
  it('summarizes asset libraries, component demos and image assets', async () => {
    await touch('components/SaaS-B/theme/palette.css')
    await touch('components/SaaS-B/theme/theme-g-one-b.css')
    await touch('components/SaaS-B/sp-button/index.html', '<button>OK</button>')
    await touch('components/SaaS-B/sp-button/effects/loading.html', '<button>Loading</button>')
    await touch('components/SaaS-C/theme/palette.css')
    await touch('components/SaaS-C/theme/theme-g-one-c.css')
    await touch('components/SaaS-C/sp-upload/demo.html', '<section>Upload</section>')
    await touch('components/business/card/demo.html', '<section>Card</section>')
    await touch('assets/icons/add.svg', '<svg />')
    await touch('assets/images/banner.png', 'png')

    const summary = await scanUikitAssetSummary(dir)

    expect(summary.assetLibraries.map((lib) => lib.name)).toEqual(['SaaS-B', 'SaaS-C', 'business'])
    expect(summary.designSystemAssets).toEqual([])
    expect(summary.assetLibraries[0].theme?.variants.map((v) => v.name)).toEqual(['g-one-b'])
    expect(summary.assetLibraries[0].components[0].demoPath).toBe('components/SaaS-B/sp-button/index.html')
    expect(summary.assetLibraries[0].components[0].demoPaths).toEqual([
      'components/SaaS-B/sp-button/effects/loading.html',
      'components/SaaS-B/sp-button/index.html'
    ])
    expect(summary.assetLibraries[2].theme).toBeNull()
    expect(summary.hasComponentsDir).toBe(true)
    expect(summary.hasDesignSystemsDir).toBe(false)
    expect(summary.componentsCount).toBe(3)
    expect(summary.designSystemCount).toBe(0)
    expect(summary.iconsCount).toBe(2)
    expect(summary.warnings).toEqual([])
  })

  it('summarizes lightweight design system assets', async () => {
    await touch('design-systems/kami/DESIGN.md', '# Kami\n')
    await touch('design-systems/kami/tokens.css', ':root { --color-bg: #fff; }\n')

    const summary = await scanUikitAssetSummary(dir)

    expect(summary.hasDesignSystemsDir).toBe(true)
    expect(summary.designSystemCount).toBe(1)
    expect(summary.designSystemAssets[0].name).toBe('kami')
    expect(summary.designSystemAssets[0].designPath).toBe('design-systems/kami/DESIGN.md')
    expect(summary.designSystemAssets[0].primaryCssPath).toBe('design-systems/kami/tokens.css')
    expect(summary.warnings).toEqual([])
  })

  it('reports missing expected asset folders', async () => {
    const summary = await scanUikitAssetSummary(dir)

    expect(summary.hasComponentsDir).toBe(false)
    expect(summary.hasDesignSystemsDir).toBe(false)
    expect(summary.hasAssetsDir).toBe(false)
    expect(summary.componentsCount).toBe(0)
    expect(summary.designSystemCount).toBe(0)
    expect(summary.iconsCount).toBe(0)
    expect(summary.warnings).toContain('缺少 components/ 或 design-systems/ 目录')
  })
})
