import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DesignSystemAsset } from '@shared/types'

const DESIGN_SYSTEMS_ROOT = 'design-systems'

async function exists(absPath: string, kind: 'dir'): Promise<boolean> {
  try {
    const st = await fs.stat(absPath)
    return st.isDirectory()
  } catch {
    return false
  }
}

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function walkFiles(rootPath: string, relDir: string): Promise<string[]> {
  const absDir = join(rootPath, relDir)
  const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = `${relDir}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootPath, rel))
      continue
    }
    if (entry.isFile()) files.push(rel)
  }
  return files.sort(comparePath)
}

function pickDesignPath(markdownPaths: string[]): string | null {
  return markdownPaths.find((path) => /\/DESIGN\.md$/i.test(path))
    ?? markdownPaths.find((path) => /\/README\.md$/i.test(path))
    ?? markdownPaths[0]
    ?? null
}

function pickPrimaryCssPath(cssPaths: string[]): string | null {
  return cssPaths.find((path) => /\/tokens\.css$/i.test(path))
    ?? cssPaths.find((path) => /\/theme\.css$/i.test(path))
    ?? cssPaths[0]
    ?? null
}

export async function hasDesignSystemsRoot(rootPath: string): Promise<boolean> {
  return exists(join(rootPath, DESIGN_SYSTEMS_ROOT), 'dir')
}

export async function listDesignSystemAssets(rootPath: string): Promise<DesignSystemAsset[]> {
  const rootAbs = join(rootPath, DESIGN_SYSTEMS_ROOT)
  const entries = await fs.readdir(rootAbs, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  const assets = await Promise.all(
    dirs.map(async (entry) => {
      const path = `${DESIGN_SYSTEMS_ROOT}/${entry.name}`
      const files = await walkFiles(rootPath, path)
      const markdownPaths = files.filter((file) => /\.md$/i.test(file))
      const cssPaths = files.filter((file) => /\.css$/i.test(file))
      return {
        name: entry.name,
        path,
        designPath: pickDesignPath(markdownPaths),
        primaryCssPath: pickPrimaryCssPath(cssPaths),
        markdownPaths,
        cssPaths,
      }
    }),
  )
  return assets.sort((a, b) => comparePath(a.name, b.name))
}
