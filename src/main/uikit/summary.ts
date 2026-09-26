import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AssetLibrary, UikitAssetSummary } from '@shared/types'
import { listAssetLibraries } from '../themes/group-scanner'
import { listDesignSystemAssets } from '../design-systems/scanner'

const IMAGE_EXT_RE = /\.(svg|png|jpe?g|webp|gif|ico|bmp)$/i

async function exists(absPath: string, kind: 'file' | 'dir'): Promise<boolean> {
  try {
    const st = await fs.stat(absPath)
    return kind === 'file' ? st.isFile() : st.isDirectory()
  } catch {
    return false
  }
}

function countComponentDemos(libraries: AssetLibrary[]): number {
  let count = 0
  for (const lib of libraries) {
    for (const comp of lib.components) {
      if (comp.hasDemo) count += 1
    }
  }
  return count
}

async function countImages(rootPath: string): Promise<number> {
  const assetsDir = join(rootPath, 'assets')
  let count = 0

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile() && IMAGE_EXT_RE.test(entry.name)) {
        count += 1
      }
    }
  }

  await walk(assetsDir)
  return count
}

function warningsFor(
  libraries: AssetLibrary[],
  designSystemCount: number,
  hasComponentsDir: boolean,
  hasDesignSystemsDir: boolean,
  hasAssetsDir: boolean
): string[] {
  const warnings: string[] = []
  if (!hasComponentsDir && !hasDesignSystemsDir) warnings.push('缺少 components/ 或 design-systems/ 目录')
  if (!hasAssetsDir && libraries.length > 0) warnings.push('缺少 assets/ 目录')
  if (hasComponentsDir && libraries.length === 0 && designSystemCount === 0) {
    warnings.push('components/ 下未发现任何资产库（应有二级子目录）')
  }
  if (hasDesignSystemsDir && designSystemCount === 0 && libraries.length === 0) {
    warnings.push('design-systems/ 下未发现任何设计风格（应有二级子目录）')
  }
  for (const lib of libraries) {
    if (lib.theme) {
      if (!lib.theme.palette.cssExists) warnings.push(`资产库 "${lib.name}" 缺 ${lib.theme.palette.cssPath}`)
      if (lib.theme.variants.length === 0) warnings.push(`资产库 "${lib.name}" 没有任何 theme-*.css 变体`)
    }
  }
  return warnings
}

export async function scanUikitAssetSummary(rootPath: string): Promise<UikitAssetSummary> {
  const [hasComponentsDir, hasDesignSystemsDir, hasAssetsDir] = await Promise.all([
    exists(join(rootPath, 'components'), 'dir'),
    exists(join(rootPath, 'design-systems'), 'dir'),
    exists(join(rootPath, 'assets'), 'dir'),
  ])

  const [assetLibraries, designSystemAssets, iconsCount] = await Promise.all([
    hasComponentsDir ? listAssetLibraries(rootPath) : Promise.resolve([]),
    hasDesignSystemsDir ? listDesignSystemAssets(rootPath) : Promise.resolve([]),
    hasAssetsDir ? countImages(rootPath) : Promise.resolve(0),
  ])

  return {
    assetLibraries,
    designSystemAssets,
    componentsCount: countComponentDemos(assetLibraries),
    designSystemCount: designSystemAssets.length,
    iconsCount,
    hasComponentsDir,
    hasDesignSystemsDir,
    hasAssetsDir,
    warnings: warningsFor(assetLibraries, designSystemAssets.length, hasComponentsDir, hasDesignSystemsDir, hasAssetsDir),
  }
}
