import type { DocTreeNode } from '@shared/types'

export type PreviewProjectContext = {
  key: string
  workspaceId: string
  spaceSlug: string
  relPath: string
  name: string
}

export type ProjectPickerItem = {
  name: string
  relPath: string
  htmlRelPath: string
}

export function collectProjectPickerItems(nodes: DocTreeNode[]): ProjectPickerItem[] {
  const projects: ProjectPickerItem[] = []
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    const html = node.children.find(child => child.kind === 'file' && /^index\.html?$/i.test(child.name))
    if (html?.kind === 'file') {
      projects.push({ name: node.name, relPath: node.relPath, htmlRelPath: html.relPath })
      continue
    }
    projects.push(...collectProjectPickerItems(node.children))
  }
  return projects
}

export function createPreviewProjectContext(
  workspaceId: string,
  spaceSlug: string,
  relPath: string,
  name?: string
): PreviewProjectContext {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return {
    key: `${workspaceId}::${spaceSlug}::${normalized}`,
    workspaceId,
    spaceSlug,
    relPath: normalized,
    name: name?.trim() || normalized.split('/').filter(Boolean).at(-1) || normalized
  }
}
