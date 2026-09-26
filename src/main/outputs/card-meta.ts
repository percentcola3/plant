import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { UiProductCardMeta } from '@shared/types'

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

export function parseUiProductCardMeta(value: unknown): UiProductCardMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return buildUiProductCardMeta(value as UiProductCardMetaInput)
}

function normalizeProductRelPath(productRelPath: string): string {
  return productRelPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

export async function updateUiProductCardMeta(
  workspacePath: string,
  productRelPath: string,
  input: UiProductCardMetaInput
): Promise<UiProductCardMeta | null> {
  const relPath = normalizeProductRelPath(productRelPath)
  const metaPath = join(workspacePath, relPath, 'meta.json')
  let root: Record<string, unknown> = {}

  try {
    const parsed = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error
    }
  }

  const card = buildUiProductCardMeta(input)
  if (card) root.card = card
  else delete root.card

  await fs.mkdir(join(workspacePath, relPath), { recursive: true })
  await fs.writeFile(metaPath, `${JSON.stringify(root, null, 2)}\n`, 'utf-8')
  return card
}
