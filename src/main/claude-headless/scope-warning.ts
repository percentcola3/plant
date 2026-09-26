import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function normalizeScopeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function findOutOfScopeArtifacts(
  changedArtifacts: string[],
  editableRoots: string[]
): string[] {
  const roots = editableRoots
    .map(normalizeScopeRelPath)
    .filter(Boolean)
  if (roots.length === 0) return []

  return changedArtifacts
    .map(normalizeScopeRelPath)
    .filter(Boolean)
    .filter((path) => !roots.some((root) => path === root || path.startsWith(`${root}/`)))
}

export function readEditableRoots(projectPath: string): string[] {
  try {
    const raw = readFileSync(join(projectPath, '.workspace', 'project-context.json'), 'utf-8')
    const context = JSON.parse(raw) as { editableRoots?: unknown }
    return Array.isArray(context.editableRoots)
      ? context.editableRoots.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
