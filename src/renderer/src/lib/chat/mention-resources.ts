import type { DocTreeNode, ExternalRef, ExternalRefBinding } from '@shared/types'

export type MentionResolvedBinding = {
  binding: ExternalRefBinding
  ref: ExternalRef
}

export type MentionResourceKind =
  | 'current-project'
  | 'knowledge'
  | 'component'
  | 'component-effect'
  | 'project-file'
  | 'webpage'

export type MentionItem =
  | { type: 'fileref'; relPath: string }
  | { type: 'chip'; alias: string; path: string }
  | {
      type: 'resource'
      resourceKind: MentionResourceKind
      alias: string
      path: string
    }

export type MentionTreeNode = {
  key: string
  label: string
  detail?: string
  icon?: string
  item?: MentionItem
  children?: MentionTreeNode[]
}

export function resolveMentionResourceBindings(
  pool: ExternalRef[],
  ...bindingSources: ExternalRefBinding[][]
): MentionResolvedBinding[] {
  const refsById = new Map(pool.map(ref => [ref.id, ref]))
  const bindingsById = new Map<string, ExternalRefBinding>()
  for (const bindings of bindingSources) {
    for (const binding of bindings) bindingsById.set(binding.externalRefId, binding)
  }
  return [...bindingsById.values()].flatMap((binding) => {
    const ref = refsById.get(binding.externalRefId)
    return ref ? [{ binding, ref }] : []
  })
}

export function mentionResourceKindLabel(kind: MentionResourceKind): string {
  switch (kind) {
    case 'current-project': return '当前项目'
    case 'knowledge': return '知识库'
    case 'component': return '组件'
    case 'component-effect': return '效果'
    case 'project-file': return '项目'
    case 'webpage': return '网页'
  }
}

export function mentionItemPath(item: MentionItem): string {
  if (item.type === 'fileref') return item.relPath
  return item.path
}

export function docTreeToMentionNodes(
  nodes: DocTreeNode[],
  itemForFile: (node: Extract<DocTreeNode, { kind: 'file' }>) => MentionItem,
  itemForFolder?: (node: Extract<DocTreeNode, { kind: 'folder' }>) => MentionItem
): MentionTreeNode[] {
  return nodes.map((node) => {
    if (node.kind === 'folder') {
      return {
        key: `folder:${node.relPath}`,
        label: node.name,
        detail: node.relPath,
        icon: 'folder',
        ...(itemForFolder ? { item: itemForFolder(node) } : {}),
        children: docTreeToMentionNodes(node.children, itemForFile, itemForFolder)
      }
    }
    return {
      key: `file:${node.relPath}`,
      label: node.name,
      detail: node.relPath,
      icon: 'file',
      item: itemForFile(node)
    }
  })
}

export function filterMentionTree(nodes: MentionTreeNode[], query: string): MentionTreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return nodes

  const result: MentionTreeNode[] = []
  for (const node of nodes) {
    const children = filterMentionTree(node.children ?? [], normalized)
    const itemPath = node.item?.type === 'resource'
      ? node.item.path
      : node.item?.type === 'fileref'
        ? node.item.relPath
        : node.item?.type === 'chip'
          ? node.item.path
          : ''
    const matches = [node.label, node.detail ?? '', itemPath]
      .some(value => value.toLowerCase().includes(normalized))
    if (matches || children.length > 0) {
      result.push({
        ...node,
        ...(node.children ? { children } : {})
      })
    }
  }
  return result
}
