import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { activeWorkAreaPath } from './paths'

// 'feature' = PM 项目的 features/<slug>/，承担 PRD + UI 子页
// （2026-06-24 PM 个人空间化重构后取代老 ui-product/<slug>）。
export type ActiveWorkArea = {
  kind: 'ui-product' | 'ui-component' | 'document' | 'feature'
  relPath: string
}

export function normalizeWorkAreaRelPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error(`invalid work area path: ${relPath}`)
  }
  return normalized
}

export async function readActiveWorkArea(workspacePath: string): Promise<ActiveWorkArea | null> {
  const path = activeWorkAreaPath(workspacePath)
  const raw = await fs.readFile(path, 'utf-8').catch(() => '')
  if (!raw.trim()) return null
  try {
    const data = JSON.parse(raw) as Partial<ActiveWorkArea>
    if (
      data.kind !== 'ui-product' && data.kind !== 'ui-component'
      && data.kind !== 'document' && data.kind !== 'feature'
    ) return null
    if (typeof data.relPath !== 'string') return null
    return { kind: data.kind, relPath: normalizeWorkAreaRelPath(data.relPath) }
  } catch {
    return null
  }
}

export async function writeActiveWorkArea(
  workspacePath: string,
  area: ActiveWorkArea | null
): Promise<void> {
  const path = activeWorkAreaPath(workspacePath)
  if (!area) {
    await fs.rm(path, { force: true }).catch(() => undefined)
    return
  }
  const next: ActiveWorkArea = {
    kind: area.kind,
    relPath: normalizeWorkAreaRelPath(area.relPath)
  }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf-8')
}
