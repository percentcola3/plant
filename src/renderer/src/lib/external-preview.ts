import type { ExternalRef } from '@shared/types'

const MARKDOWN_RE = /\.(md|mdx|markdown)$/i

export function isMarkdownPreviewPath(relPath: string | null | undefined): boolean {
  return MARKDOWN_RE.test(relPath ?? '')
}

export function externalRefSourceText(ref: ExternalRef | null | undefined): string {
  return ref?.source ?? ''
}

function encodeRelUrl(relPath: string): string {
  return relPath.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/')
}

export function buildProjectFilePreviewUrl(
  previewUrl: string,
  workspaceId: string,
  rootRel: string,
  relPath: string
): string {
  const origin = new URL(previewUrl).origin
  const fullRel = [rootRel, relPath].filter(Boolean).join('/')
  return `${origin}/p/${encodeURIComponent(workspaceId)}/${encodeRelUrl(fullRel)}`
}

export function buildComponentPreviewDetailUrl(
  componentsPreviewUrl: string,
  category: string,
  name: string
): string {
  const url = new URL(componentsPreviewUrl)
  url.hash = `/c/${encodeURIComponent(category)}/${encodeURIComponent(name)}`
  return url.toString()
}
