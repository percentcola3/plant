import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..', '..', '..')

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('ProductFilesBrandMenu', () => {
  const brandMenuSource = read('src/components/preview/ProductFilesBrandMenu.vue')
  const productFilesSource = read('src/components/preview/ProductFilesTabPane.vue')

  it('matches PEEKA brand menu structure with rename and delete actions', () => {
    expect(brandMenuSource).toContain('product-brand-menu')
    expect(brandMenuSource).toContain('product-brand--trigger')
    expect(brandMenuSource).toContain("import { PenTool } from 'lucide-vue-next'")
    expect(brandMenuSource).toContain('<PenTool class="product-brand__icon-glyph"')
    expect(brandMenuSource).toContain('product-brand__title')
    expect(brandMenuSource).toContain('background: var(--color-brand-accent)')
    expect(brandMenuSource).toContain('color: var(--color-text-onbrand)')
    expect(brandMenuSource).toContain('width: 24px')
    expect(brandMenuSource).toContain('width: 14px')
    expect(brandMenuSource).toContain('重命名')
    expect(brandMenuSource).toContain('删除')
    expect(brandMenuSource).toContain('product-brand-dropdown__item--danger')
  })

  it('replaces workbench title/path blocks with the brand menu trigger', () => {
    expect(productFilesSource).toContain("import ProductFilesBrandMenu from './ProductFilesBrandMenu.vue'")
    expect(productFilesSource).toContain('<ProductFilesBrandMenu')
    expect(productFilesSource).toContain(':title="headerBrandTitle"')
    expect(productFilesSource).toContain('resolveWorkbenchBrandTitle')
    expect(productFilesSource).not.toContain('product-files__editor-path">{{ textSession.relPath }}')
    expect(productFilesSource).not.toContain('>预览</div>')
    expect(productFilesSource).not.toContain('@click="deleteSelectedFile"')
  })
})
