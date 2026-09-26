import { describe, expect, it } from 'vitest'
import type { DocTreeNode } from '@shared/types'
import {
  buildGroupedOutputProducts,
  collectOutputGroups,
  productMoveOptions,
  UNGROUPED_GROUP_VALUE
} from './ui-products'

type Product = {
  relPath: string
  modifiedAt: string | null
}

function file(relPath: string, modifiedAt = '2026-07-03T00:00:00.000Z'): DocTreeNode {
  return {
    kind: 'file',
    name: relPath.split('/').pop() ?? relPath,
    relPath,
    size: 1,
    modifiedAt,
  }
}

function folder(relPath: string, children: DocTreeNode[]): DocTreeNode {
  return {
    kind: 'folder',
    name: relPath.split('/').pop() ?? relPath,
    relPath,
    children,
  }
}

describe('ui output product grouping', () => {
  it('collects output groups including empty folders, without treating product internals as groups', () => {
    const tree: DocTreeNode[] = [
      folder('outputs/auth', [
        folder('outputs/auth/login', [
          file('outputs/auth/login/index.html')
        ])
      ]),
      folder('outputs/empty', []),
      folder('outputs/root-product', [
        file('outputs/root-product/index.html'),
        folder('outputs/root-product/assets', [
          file('outputs/root-product/assets/app.css')
        ])
      ])
    ]

    expect(collectOutputGroups(tree)).toEqual(['auth', 'empty'])
  })

  it('keeps empty groups visible when building grouped product sections', () => {
    const products: Product[] = [
      { relPath: 'outputs/root-product', modifiedAt: '2026-07-03T10:00:00.000Z' },
      { relPath: 'outputs/auth/login', modifiedAt: '2026-07-03T11:00:00.000Z' }
    ]

    expect(buildGroupedOutputProducts(products, ['auth', 'empty'])).toEqual([
      { group: 'auth', products: [{ relPath: 'outputs/auth/login', modifiedAt: '2026-07-03T11:00:00.000Z' }] },
      { group: 'empty', products: [] },
      { group: null, products: [{ relPath: 'outputs/root-product', modifiedAt: '2026-07-03T10:00:00.000Z' }] }
    ])
  })

  it('builds dropdown options for moving products between existing groups', () => {
    expect(productMoveOptions(['auth', 'empty'], 'auth')).toEqual([
      {
        label: '未分组',
        value: UNGROUPED_GROUP_VALUE,
        description: '移动到 outputs/ 根目录'
      },
      {
        label: 'auth',
        value: 'auth',
        description: '当前分组'
      },
      {
        label: 'empty',
        value: 'empty',
        description: 'outputs/empty/'
      }
    ])
  })
})
