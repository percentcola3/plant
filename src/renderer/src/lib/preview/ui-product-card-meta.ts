import type { DocTreeNode, UiProductCardMeta } from '@shared/types'
import { call } from '@/lib/api'

export function parseMetaJsonCardContent(raw: string): UiProductCardMeta | null {
  try {
    const parsed = JSON.parse(raw) as { card?: UiProductCardMetaInput }
    if (!parsed?.card || typeof parsed.card !== 'object' || Array.isArray(parsed.card)) return null
    return buildUiProductCardMeta(parsed.card)
  } catch {
    return null
  }
}

export async function loadUiProductCardMeta(
  workspaceId: string,
  rootRelPath: string
): Promise<UiProductCardMeta | null> {
  const metaRelPath = `${rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')}/meta.json`
  const exists = await call('editor.entryExists', {
    workspaceId,
    relPath: metaRelPath,
    scope: 'project',
  })
  if (!exists.ok || !exists.data.exists) return null
  const r = await call('editor.readTextFile', {
    workspaceId,
    relPath: metaRelPath,
    scope: 'project',
  })
  if (!r.ok) return null
  return parseMetaJsonCardContent(r.data.content)
}

export function productRootFolderName(rootRelPath: string): string {
  return rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).at(-1) ?? ''
}

export function resolveWorkbenchBrandTitle(
  card: UiProductCardMeta | null | undefined,
  rootRelPath: string
): string {
  return resolveProductPreviewTitle(card, productRootFolderName(rootRelPath)) || '未命名'
}

export type UiProductCardMetaInput = {
  title?: string
  coverTag?: string
  uxName?: string
  pmName?: string
}

export function buildUiProductCardMeta(input: UiProductCardMetaInput): UiProductCardMeta | null {
  const card: UiProductCardMeta = {}
  const title = input.title?.trim()
  const coverTag = input.coverTag?.trim()
  const uxName = input.uxName?.trim()
  const pmName = input.pmName?.trim()
  if (title) card.title = title
  if (coverTag) card.coverTag = coverTag
  if (uxName) card.uxName = uxName
  if (pmName) card.pmName = pmName
  return Object.keys(card).length > 0 ? card : null
}

export function resolveProductPreviewTitle(
  card: UiProductCardMeta | null | undefined,
  folderName: string
): string {
  return card?.title?.trim() || folderName
}

export function resolveProductPreviewTag(
  card: UiProductCardMeta | null | undefined,
  group: string | null
): string {
  if (card?.coverTag) return card.coverTag.toUpperCase()
  if (group) return group.toUpperCase()
  return 'SAAS'
}

export function productPreviewPeople(card: UiProductCardMeta | null | undefined): string[] {
  const lines: string[] = []
  if (card?.uxName) lines.push(`UX: ${card.uxName}`)
  if (card?.pmName) lines.push(`PM: ${card.pmName}`)
  return lines
}

export function patchOutputsTreeProductCard(
  nodes: DocTreeNode[],
  productRelPath: string,
  card: UiProductCardMeta | null,
  nextRelPath?: string
): DocTreeNode[] {
  const nextName = nextRelPath?.split('/').filter(Boolean).at(-1)
  return nodes.map((node) => {
    if (node.kind !== 'folder') return node
    if (node.relPath === productRelPath) {
      return {
        ...node,
        relPath: nextRelPath ?? node.relPath,
        name: nextName ?? node.name,
        uiProductCard: card,
      }
    }
    return {
      ...node,
      children: patchOutputsTreeProductCard(node.children, productRelPath, card, nextRelPath),
    }
  })
}

export async function saveUiProductCardMeta(
  workspaceId: string,
  productRelPath: string,
  input: UiProductCardMetaInput
): Promise<{ ok: true; card: UiProductCardMeta | null } | { ok: false; message: string }> {
  const write = await call('uiProduct.updateCardMeta', {
    workspaceId,
    productRelPath,
    title: input.title,
    coverTag: input.coverTag,
    uxName: input.uxName,
    pmName: input.pmName,
  })
  if (!write.ok) return { ok: false, message: write.message }
  return { ok: true, card: write.data }
}
