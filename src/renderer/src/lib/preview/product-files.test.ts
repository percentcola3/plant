import { describe, expect, it } from 'vitest'
import type { DocTreeNode } from '@shared/types'
import * as productFileHelpers from './product-files'
import {
  buildProductFileTree,
  defaultExpandedProductFolderPaths,
  flattenProductFiles,
  isDocFolderName,
  productFileDisplayName,
  isEditableProductFile,
  isProductImageFile,
  nextSketchFileRelPath,
  productFileAncestorDirs,
  productAssetUploadDir,
  productAssetUploadFileNameError,
  productTreeChangeMarks,
  selectProductFileAfterDelete
} from './product-files'

describe('product file helpers', () => {
  const tree: DocTreeNode[] = [
    {
      kind: 'file',
      name: 'index.html',
      relPath: 'ui/order/index.html',
      size: 120,
      modifiedAt: '2026-06-18T01:00:00.000Z',
    },
    {
      kind: 'folder',
      name: 'assets',
      relPath: 'ui/order/assets',
      children: [
        {
          kind: 'file',
          name: 'hero.png',
          relPath: 'ui/order/assets/hero.png',
          size: 12,
          modifiedAt: '2026-06-18T01:02:00.000Z',
        },
        {
          kind: 'file',
          name: 'map.svg',
          relPath: 'ui/order/assets/map.svg',
          size: 42,
          modifiedAt: '2026-06-18T01:03:00.000Z',
        },
        {
          kind: 'folder',
          name: 'page-order-card',
          relPath: 'ui/order/assets/page-order-card',
          children: [
            {
              kind: 'file',
              name: 'delivery.svg',
              relPath: 'ui/order/assets/page-order-card/delivery.svg',
              size: 52,
              modifiedAt: '2026-06-18T01:06:00.000Z',
            }
          ],
        }
      ],
    },
    {
      kind: 'file',
      name: 'sketch-2026-06-18.sketch.json',
      relPath: 'ui/order/sketch-2026-06-18.sketch.json',
      size: 80,
      modifiedAt: '2026-06-18T01:01:00.000Z',
    }
  ]

  it('maps common file types to simple text icons', () => {
    const productFileIcon = (productFileHelpers as Record<string, unknown>).productFileIcon
    expect(productFileIcon).toBeTypeOf('function')
    const icon = productFileIcon as (fileName: string) => string

    expect(icon('index.html')).toBe('<>')
    expect(icon('README.md')).toBe('#')
    expect(icon('meta.json')).toBe('{}')
    expect(icon('theme.css')).toBe('*')
    expect(icon('app.ts')).toBe('TS')
    expect(icon('app.js')).toBe('JS')
    expect(icon('hero.png')).toBe('▧')
    expect(icon('brand.woff2')).toBe('Aa')
    expect(icon('notes.txt')).toBe('·')
  })

  it('flattens files with stable display categories', () => {
    expect(flattenProductFiles(tree).map((file) => ({
      relPath: file.relPath,
      category: file.category,
      editable: file.editable
    }))).toEqual([
      { relPath: 'ui/order/index.html', category: '页面', editable: true },
      { relPath: 'ui/order/sketch-2026-06-18.sketch.json', category: '草图', editable: true },
      { relPath: 'ui/order/assets/hero.png', category: '资源', editable: false },
      { relPath: 'ui/order/assets/map.svg', category: '资源', editable: false },
      { relPath: 'ui/order/assets/page-order-card/delivery.svg', category: '资源', editable: false }
    ])
  })

  it('allows editing source text and sketch files only', () => {
    expect(isEditableProductFile('ui/order/index.html')).toBe(true)
    expect(isEditableProductFile('ui/order/style.css')).toBe(true)
    expect(isEditableProductFile('ui/order/sketch.sketch.json')).toBe(true)
    expect(isEditableProductFile('ui/order/assets/hero.png')).toBe(false)
    expect(isEditableProductFile('ui/order/assets/map.svg')).toBe(false)
  })

  it('treats svg and raster files as previewable image resources', () => {
    expect(isProductImageFile('ui/order/assets/map.svg')).toBe(true)
    expect(isProductImageFile('ui/order/assets/hero.png')).toBe(true)
  })

  it('uploads product resources into product assets directory', () => {
    expect(productAssetUploadDir('ui/order')).toBe('ui/order/assets')
  })

  it('rejects non-english product asset upload file names', () => {
    expect(productAssetUploadFileNameError('hero.png')).toBeNull()
    expect(productAssetUploadFileNameError('hero_icon-2.svg')).toBeNull()
    expect(productAssetUploadFileNameError('底部导航.png')).toBe('文件名只能包含英文字母、数字、点、下划线或中划线：底部导航.png')
    expect(productAssetUploadFileNameError('hero image.png')).toBe('文件名只能包含英文字母、数字、点、下划线或中划线：hero image.png')
  })

  it('selects the nearest remaining file after deletion', () => {
    const files = flattenProductFiles(tree)

    expect(selectProductFileAfterDelete(files, 'ui/order/index.html')).toBe('ui/order/sketch-2026-06-18.sketch.json')
    expect(selectProductFileAfterDelete(files, 'ui/order/assets/map.svg')).toBe('ui/order/assets/page-order-card/delivery.svg')
    expect(selectProductFileAfterDelete([files[0]], files[0].relPath)).toBeNull()
  })

  it('creates simple numbered draft sketch names', () => {
    const files = [
      {
        name: '草稿1.sketch.json',
        relPath: 'ui/order/草稿1.sketch.json',
        category: '草图' as const,
        editable: true,
        size: 1,
        modifiedAt: '2026-06-18T01:04:00.000Z'
      },
      {
        name: '草稿3.sketch.json',
        relPath: 'ui/order/草稿3.sketch.json',
        category: '草图' as const,
        editable: true,
        size: 1,
        modifiedAt: '2026-06-18T01:05:00.000Z'
      }
    ]

    expect(nextSketchFileRelPath('ui/order', files)).toBe('ui/order/草稿2.sketch.json')
    expect(productFileDisplayName(files.find((file) => file.relPath === 'ui/order/草稿1.sketch.json')!)).toBe('草稿1')
  })

  it('shows legacy timestamp sketch files as draft names', () => {
    const files = flattenProductFiles(tree)
    const legacySketch = files.find((file) => file.category === '草图')!

    expect(productFileDisplayName(legacySketch, files)).toBe('草稿1')
    expect(nextSketchFileRelPath('ui/order', files)).toBe('ui/order/草稿2.sketch.json')
  })

  it('builds a collapsible directory tree from product files', () => {
    const nodes = buildProductFileTree(flattenProductFiles(tree), 'ui/order')

    expect(nodes.map((node) => `${node.kind}:${node.name}`)).toEqual([
      'folder:assets',
      'file:index.html',
      'file:sketch-2026-06-18.sketch.json'
    ])
    expect(nodes[0]).toMatchObject({
      kind: 'folder',
      relPath: 'ui/order/assets',
      children: [
        { kind: 'folder', name: 'page-order-card', relPath: 'ui/order/assets/page-order-card' },
        { kind: 'file', name: 'hero.png' },
        { kind: 'file', name: 'map.svg' }
      ]
    })
  })

  it('returns product file ancestor directories inside the product root', () => {
    expect(productFileAncestorDirs('ui/order', 'ui/order/assets/page-order-card/delivery.svg')).toEqual([
      'ui/order/assets',
      'ui/order/assets/page-order-card'
    ])
    expect(productFileAncestorDirs('ui/order', 'ui/order/index.html')).toEqual([])
  })

  it('expands doc folders by default and marks added or modified files only', () => {
    expect(isDocFolderName('doc')).toBe(true)
    expect(isDocFolderName('DOC')).toBe(true)
    expect(isDocFolderName('assets')).toBe(false)
    expect(defaultExpandedProductFolderPaths('features/pos', [
      { relPath: 'features/pos/doc/方案.md' },
      { relPath: 'features/pos/index.html' }
    ])).toEqual(['features/pos/doc'])

    const marks = productTreeChangeMarks('features/pos', [
      { path: 'features/pos/doc/方案.md', kind: 'added' },
      { path: 'features/pos/index.html', kind: 'modified' },
      { path: 'features/pos/gone.md', kind: 'deleted' },
      { path: 'features/other/a.md', kind: 'untracked' }
    ])
    expect([...marks.entries()]).toEqual([
      ['features/pos/doc/方案.md', 'added'],
      ['features/pos/index.html', 'modified']
    ])
  })
})
