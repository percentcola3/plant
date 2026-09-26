import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AssetLibrary, Workspace, WorkspaceScanResult } from '@shared/types'
import { listAssetLibraries } from '../themes/group-scanner'
import { hasDesignSystemsRoot, listDesignSystemAssets } from '../design-systems/scanner'
import { listFeatures } from '../features/scanner'
import { readDocTree } from './doc-tree'
import { readRefs } from './refs'
import { knowledgeDir } from './paths'
import { readExternalManifest } from './external-manifest'
import { readPersonalSpaceByPath } from './personal-space'
import { supportsPersonalSpaces } from '@shared/workspace-policy'

// Workspace.kind 分流入口。三类工作区视图共享同一套 git/同步/冲突解决，
// 但扫描结果形状不同，UI 据此渲染不同视图。
//
// asset / ux 工作区采用资产库模型：components/ 下每个二级目录 = 一个资产库。
// 每个资产库自带 theme/（可选）+ 若干组件子目录。

const ASSET_FIXED = {
  componentsDir: 'components',
  designSystemsDir: 'design-systems',
  assetsDir: 'assets',
  outputsDir: 'outputs',
} as const

async function exists(absPath: string, kind: 'file' | 'dir'): Promise<boolean> {
  try {
    const st = await fs.stat(absPath)
    return kind === 'file' ? st.isFile() : st.isDirectory()
  } catch {
    return false
  }
}

async function assertDirExists(absPath: string): Promise<void> {
  try {
    const st = await fs.stat(absPath)
    if (!st.isDirectory()) throw new Error('not a directory')
  } catch {
    const e = new Error(`工作区目录不存在或无法访问：${absPath}`)
    ;(e as Error & { code: string }).code = 'WORKSPACE_DIR_MISSING'
    throw e
  }
}

async function scanProjectWorkspace(ws: Workspace): Promise<WorkspaceScanResult> {
  const [
    features,
    refs,
    manifest,
    hasKnowledgeDir,
    personalSpace,
  ] = await Promise.all([
    listFeatures(ws.path),
    readRefs(ws.path),
    readExternalManifest(ws.path),
    exists(knowledgeDir(ws.path), 'dir'),
    supportsPersonalSpaces(ws)
      ? readPersonalSpaceByPath(ws.path, ws.defaultBranch)
      : Promise.resolve(null),
  ])
  const mountedAliases = new Set(refs.map((ref) => ref.alias))
  const externalWarnings = manifest.refs
    .filter((ref) => !mountedAliases.has(ref.alias))
    .map((ref) => `外部依赖 "${ref.alias}" 尚未初始化，点击"更新外联"完成挂载`)
  return {
    kind: 'project',
    warnings: externalWarnings,
    features,
    refs,
    hasKnowledgeDir,
    personalSpace,
  }
}

function assetLibraryWarnings(libraries: AssetLibrary[]): string[] {
  const warnings: string[] = []
  for (const lib of libraries) {
    if (lib.theme) {
      if (!lib.theme.palette.cssExists) warnings.push(`资产库 "${lib.name}" 缺 ${lib.theme.palette.cssPath}`)
      if (lib.theme.variants.length === 0) warnings.push(`资产库 "${lib.name}" 没有任何 theme-*.css 变体`)
    }
  }
  return warnings
}

async function scanAssetWorkspace(ws: Workspace): Promise<WorkspaceScanResult> {
  const join_ = (rel: string) => join(ws.path, rel)
  const warnings: string[] = []

  const [hasComponentsDir, hasDesignSystemsDir, hasAssetsDir] = await Promise.all([
    exists(join_(ASSET_FIXED.componentsDir), 'dir'),
    hasDesignSystemsRoot(ws.path),
    exists(join_(ASSET_FIXED.assetsDir), 'dir'),
  ])

  const [assetLibraries, designSystemAssets] = await Promise.all([
    hasComponentsDir ? listAssetLibraries(ws.path) : Promise.resolve([]),
    hasDesignSystemsDir ? listDesignSystemAssets(ws.path) : Promise.resolve([]),
  ])
  const hasAnyDesignAsset = assetLibraries.length > 0 || designSystemAssets.length > 0
  if (!hasComponentsDir && !hasDesignSystemsDir) {
    warnings.push(`缺少 ${ASSET_FIXED.componentsDir}/ 或 ${ASSET_FIXED.designSystemsDir}/ 目录`)
  }
  if (hasComponentsDir && assetLibraries.length === 0 && !hasAnyDesignAsset) {
    warnings.push(`${ASSET_FIXED.componentsDir}/ 下未发现任何资产库（应有二级子目录）`)
  }
  if (hasDesignSystemsDir && designSystemAssets.length === 0 && !hasAnyDesignAsset) {
    warnings.push(`${ASSET_FIXED.designSystemsDir}/ 下未发现任何设计风格（应有二级子目录）`)
  }
  if (!hasAssetsDir && assetLibraries.length > 0) warnings.push(`缺少 ${ASSET_FIXED.assetsDir}/ 目录`)
  warnings.push(...assetLibraryWarnings(assetLibraries))

  return {
    kind: 'asset',
    warnings,
    assetLibraries,
    designSystemAssets,
    hasComponentsDir,
    hasDesignSystemsDir,
    hasAssetsDir,
  }
}

async function scanUxWorkspace(ws: Workspace): Promise<WorkspaceScanResult> {
  const [asset, hasOutputsDir, personalSpace] = await Promise.all([
    scanAssetWorkspace(ws),
    exists(join(ws.path, ASSET_FIXED.outputsDir), 'dir'),
    supportsPersonalSpaces(ws)
      ? readPersonalSpaceByPath(ws.path, ws.defaultBranch)
      : Promise.resolve(null),
  ])
  if (asset.kind !== 'asset') throw new Error('unexpected asset scan result')
  return {
    ...asset,
    kind: 'ux',
    hasOutputsDir,
    personalSpace,
  }
}

async function scanKnowledgeWorkspace(ws: Workspace): Promise<WorkspaceScanResult> {
  const tree = await readDocTree(ws.path, '.')
  return {
    kind: 'knowledge',
    warnings: [],
    tree,
  }
}

export async function scanWorkspace(ws: Workspace): Promise<WorkspaceScanResult> {
  await assertDirExists(ws.path)
  switch (ws.kind) {
    case 'project':
      return scanProjectWorkspace(ws)
    case 'ux':
      return scanUxWorkspace(ws)
    case 'asset':
      return scanAssetWorkspace(ws)
    case 'knowledge':
      return scanKnowledgeWorkspace(ws)
  }
}
