import { describe, expect, it } from 'vitest'
import type { DocTreeNode, ExternalRef, ExternalRefBinding } from '@shared/types'
import {
  docTreeToMentionNodes,
  filterMentionTree,
  resolveMentionResourceBindings
} from './mention-resources'

const tree: DocTreeNode[] = [{
  kind: 'folder',
  name: '业务规则',
  relPath: '.external/订单知识库/业务规则',
  children: [{
    kind: 'file',
    name: '退款规则.md',
    relPath: '.external/订单知识库/业务规则/退款规则.md',
    size: 12,
    modifiedAt: '2026-07-23T00:00:00.000Z',
    publish: null
  }],
  uiProductPublish: null
}]

describe('mention resources', () => {
  it('makes folders and files selectable mention resources', () => {
    const toResource = (path: string, label: string) => ({
      type: 'resource' as const,
      resourceKind: 'knowledge' as const,
      alias: `订单知识库/${label}`,
      path
    })
    const nodes = docTreeToMentionNodes(
      tree,
      file => toResource(file.relPath, file.name),
      folder => toResource(folder.relPath, folder.name)
    )

    expect(nodes[0].label).toBe('业务规则')
    expect(nodes[0].item).toEqual({
      type: 'resource',
      resourceKind: 'knowledge',
      alias: '订单知识库/业务规则',
      path: '.external/订单知识库/业务规则'
    })
    expect(nodes[0].children?.[0].item).toEqual({
      type: 'resource',
      resourceKind: 'knowledge',
      alias: '订单知识库/退款规则.md',
      path: '.external/订单知识库/业务规则/退款规则.md'
    })
  })

  it('keeps matching ancestors when filtering nested files', () => {
    const nodes = docTreeToMentionNodes(tree, file => ({
      type: 'resource',
      resourceKind: 'knowledge',
      alias: file.name,
      path: file.relPath
    }))

    const filtered = filterMentionTree(nodes, '退款')

    expect(filtered).toHaveLength(1)
    expect(filtered[0].children).toHaveLength(1)
    expect(filtered[0].children?.[0].label).toBe('退款规则.md')
  })

  it('merges scanned and freshly fetched bindings against one resource pool snapshot', () => {
    const pool: ExternalRef[] = [
      {
        id: 'ui-1',
        alias: 'SaaSUI',
        kind: 'git',
        category: 'uikit',
        source: 'git@example.com:ui.git',
        poolPath: '/pool/ui-1',
        addedAt: '2026-07-29T00:00:00.000Z'
      },
      {
        id: 'kb-1',
        alias: '业务知识',
        kind: 'local',
        category: 'knowledge',
        source: '/knowledge',
        poolPath: '/knowledge',
        addedAt: '2026-07-29T00:00:00.000Z'
      }
    ]
    const scanned: ExternalRefBinding[] = [{
      alias: 'SaaSUI',
      externalRefId: 'ui-1',
      addedAt: '2026-07-29T00:00:00.000Z'
    }]
    const fetched: ExternalRefBinding[] = [{
      alias: '业务知识',
      externalRefId: 'kb-1',
      addedAt: '2026-07-29T00:00:00.000Z'
    }]

    expect(resolveMentionResourceBindings(pool, scanned, fetched).map(item => item.ref.alias))
      .toEqual(['SaaSUI', '业务知识'])
  })
})
