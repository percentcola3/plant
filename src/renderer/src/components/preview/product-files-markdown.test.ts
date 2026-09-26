import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const productFilesSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/ProductFilesTabPane.vue'),
  'utf-8'
)

describe('product files markdown editing', () => {
  it('renders markdown files with the document preview/editor experience', () => {
    expect(productFilesSource).toContain('renderMarkdownPreview')
    expect(productFilesSource).toContain('isSelectedMarkdown')
    expect(productFilesSource).toContain('markdownMode')
    expect(productFilesSource).toContain('product-files__md-preview-frame')
    expect(productFilesSource).toContain("insertMarkdownShortcut('emphasis')")
    expect(productFilesSource).toContain("insertMarkdownShortcut('table')")
    expect(productFilesSource).toContain('text-variant="markdown"')
  })
})
