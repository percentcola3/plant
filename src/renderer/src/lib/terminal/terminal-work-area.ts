export type ClaudeWorkArea =
  | { kind: 'ui-product'; relPath: string }
  | { kind: 'ui-component'; relPath: string }
  | { kind: 'document'; relPath: string }
  | { kind: 'feature'; relPath: string }
  | null

export type PreviewWorkAreaTarget =
  | { type: 'product'; path: string }
  | { type: 'component'; path: string }
  | { type: 'files'; rootRelPath: string }

export type WorkAreaTargetDocument = {
  relPath: string
}

function normalizeRelPath(path: string | undefined): string | null {
  const normalized = (path ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized || normalized.split('/').includes('..')) return null
  return normalized
}

function productLikeWorkArea(
  workspaceKind: string | undefined,
  relPath: string
): Exclude<ClaudeWorkArea, null> | null {
  if (workspaceKind === 'project' && relPath.startsWith('features/')) {
    return { kind: 'feature', relPath }
  }
  return { kind: 'ui-product', relPath }
}

export function resolveClaudeWorkAreaFromTargets(input: {
  workspaceKind?: string
  preview?: PreviewWorkAreaTarget
  targetDocument?: WorkAreaTargetDocument
}): ClaudeWorkArea {
  const preview = input.preview
  if (preview?.type === 'component') {
    const relPath = normalizeRelPath(preview.path)
    return relPath ? { kind: 'ui-component', relPath } : null
  }
  if (preview?.type === 'product') {
    const relPath = normalizeRelPath(preview.path)
    return relPath ? productLikeWorkArea(input.workspaceKind, relPath) : null
  }
  if (preview?.type === 'files') {
    const relPath = normalizeRelPath(preview.rootRelPath)
    return relPath ? productLikeWorkArea(input.workspaceKind, relPath) : null
  }

  const targetRelPath = normalizeRelPath(input.targetDocument?.relPath)
  return targetRelPath ? { kind: 'document', relPath: targetRelPath } : null
}
