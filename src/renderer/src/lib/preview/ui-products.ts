import type { DocTreeNode } from '@shared/types'

export const UNGROUPED_GROUP_VALUE = '__ungrouped__'

export type OutputProductLike = {
  relPath: string
  modifiedAt: string | null
}

export type OutputProductSection<T extends OutputProductLike> = {
  group: string | null
  products: T[]
}

export type ProductMoveOption = {
  label: string
  value: string
  description?: string
}

export function outputGroupOfRelPath(relPath: string): string | null {
  const stripped = relPath.replace(/^outputs\//, '')
  const segments = stripped.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  return segments.slice(0, -1).join('/')
}

function hasRootIndexHtml(node: Extract<DocTreeNode, { kind: 'folder' }>): boolean {
  return node.children.some((child) =>
    child.kind === 'file' && /^index\.html?$/i.test(child.name)
  )
}

export function collectOutputGroups(nodes: DocTreeNode[]): string[] {
  const groups = new Set<string>()

  function visit(node: DocTreeNode): void {
    if (node.kind !== 'folder') return
    if (hasRootIndexHtml(node)) return

    const group = node.relPath.replace(/^outputs\//, '').replace(/\/+$/, '')
    if (group && group !== node.relPath) groups.add(group)
    for (const child of node.children) visit(child)
  }

  for (const node of nodes) visit(node)
  return [...groups].sort()
}

function sortByActive<T extends OutputProductLike>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
}

export function buildGroupedOutputProducts<T extends OutputProductLike>(
  products: T[],
  groups: string[]
): Array<OutputProductSection<T>> {
  const map = new Map<string | null, T[]>()
  for (const group of groups) map.set(group, [])
  for (const product of products) {
    const group = outputGroupOfRelPath(product.relPath)
    const arr = map.get(group) ?? []
    arr.push(product)
    map.set(group, arr)
  }

  const sections: Array<OutputProductSection<T>> = []
  for (const group of [...map.keys()].filter((key): key is string => key !== null).sort()) {
    sections.push({ group, products: sortByActive(map.get(group) ?? []) })
  }
  if (map.has(null)) {
    sections.push({ group: null, products: sortByActive(map.get(null) ?? []) })
  }
  return sections
}

export function productMoveOptions(groups: string[], currentGroup: string | null): ProductMoveOption[] {
  return [
    {
      label: '未分组',
      value: UNGROUPED_GROUP_VALUE,
      description: currentGroup === null ? '当前分组' : '移动到 outputs/ 根目录'
    },
    ...groups.map((group) => ({
      label: group,
      value: group,
      description: group === currentGroup ? '当前分组' : `outputs/${group}/`
    }))
  ]
}
