import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type ArtifactSnapshot = Map<string, { mtimeMs: number; size: number }>

const IGNORED_DIRS = new Set([
  '.git',
  '.claude',
  '.ui-client',      // App 内部状态（saga journals / refs / active-work-area / branch-prefs 等）
  '.workspace',      // Claude session 索引 / project-context
  '.external',       // 外挂 UI 资产软链，不算业务改动
  'node_modules',
  'dist',
  'web-dist',
  'out',
  'coverage'
])

const TRACKED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.json'
])

export function snapshotProjectArtifacts(projectPath: string): ArtifactSnapshot {
  const snapshot: ArtifactSnapshot = new Map()
  walk(projectPath, projectPath, snapshot)
  return snapshot
}

export function compareArtifactSnapshots(before: ArtifactSnapshot, after: ArtifactSnapshot): string[] {
  const changed = new Set<string>()

  for (const [path, next] of after) {
    const prev = before.get(path)
    if (!prev || prev.size !== next.size || prev.mtimeMs !== next.mtimeMs) {
      changed.add(path)
    }
  }

  for (const path of before.keys()) {
    if (!after.has(path)) changed.add(path)
  }

  return [...changed].sort((a, b) => a.localeCompare(b))
}

function walk(root: string, current: string, snapshot: ArtifactSnapshot): void {
  let entries: string[]
  try {
    entries = readdirSync(current)
  } catch {
    return
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue
    const abs = join(current, entry)
    let stat
    try {
      stat = statSync(abs)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walk(root, abs, snapshot)
      continue
    }
    if (!stat.isFile() || !isTrackedFile(entry)) continue
    snapshot.set(toPosix(relative(root, abs)), {
      mtimeMs: stat.mtimeMs,
      size: stat.size
    })
  }
}

function isTrackedFile(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0) return false
  return TRACKED_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase())
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}
