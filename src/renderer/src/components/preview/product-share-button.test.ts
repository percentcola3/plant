import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const productFilesSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/ProductFilesTabPane.vue'),
  'utf-8'
)
const shareButtonSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/ProductShareButton.vue'),
  'utf-8'
)

describe('ProductShareButton in product files pane', () => {
  it('renders project share at the rightmost side of inner page toolbars', () => {
    expect(productFilesSource).toContain("import ProductShareButton from './ProductShareButton.vue'")
    expect(productFilesSource).toContain('<ProductShareButton')
    expect(productFilesSource).toContain(':product-rel-path="props.rootRelPath"')
    expect(productFilesSource).toContain('product-files__preview-head product-files__workbench-topbar')
    expect(productFilesSource).toContain('product-files__editor-head product-files__workbench-topbar')
    expect(productFilesSource).toContain('@click="reloadSelectedFile"')
    expect(productFilesSource).toContain('@click="saveCurrent"')
  })

  it('supports UX and PM publish flows from preview project roots', () => {
    expect(shareButtonSource).toContain("relPath.startsWith('outputs/')")
    expect(shareButtonSource).toContain("relPath.startsWith('features/')")
    expect(shareButtonSource).toContain("'uiProduct.publish'")
    expect(shareButtonSource).toContain("'feature.publish'")
    expect(shareButtonSource).toContain("'分享'")
    expect(shareButtonSource).toContain('class="product-share-menu"')
    expect(shareButtonSource).toContain('var(--product-workbench-control-height, 26px)')
    expect(shareButtonSource).toContain('padding: 0 12px')
    expect(shareButtonSource).toContain('border-radius: 6px')
    expect(shareButtonSource).toContain('var(--color-button-bg)')
  })

  it('checks optional publish metadata before strict file reads', () => {
    expect(shareButtonSource).toContain("call('editor.entryExists'")
    expect(shareButtonSource).toContain('if (!exists.ok || !exists.data.exists) return null')
    expect(productFilesSource).toContain("startsWith('outputs/')")
  })
})
