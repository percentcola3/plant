import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AssetComponent, AssetLibrary, ThemeGroup, ThemeVariant } from '@shared/types'

// 资产库扫描公共逻辑。
//
// 新模型：components/<lib>/theme/ 下直接是 palette.css + theme-*.css（不再有内层 group 目录）。
// 每个资产库 = 一个二级目录 = 至多一个 theme/ + 若干组件子目录。

async function exists(absPath: string, kind: 'file' | 'dir'): Promise<boolean> {
  try {
    const st = await fs.stat(absPath)
    return kind === 'file' ? st.isFile() : st.isDirectory()
  } catch {
    return false
  }
}

export function variantNameFromFile(filename: string): string | null {
  if (filename === 'theme.css') return 'default'
  const m = filename.match(/^theme-(.+)\.css$/)
  return m ? m[1] : null
}

function compareAssetName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// 扫单个资产库的 theme/ 目录。返回 null 表示该资产库没有主题（合法状态，如 business/）。
export async function scanLibraryTheme(
  rootPath: string,
  libraryRel: string,
  libraryName: string,
): Promise<ThemeGroup | null> {
  const themeRel = `${libraryRel}/theme`
  const themeAbs = join(rootPath, themeRel)
  if (!(await exists(themeAbs, 'dir'))) return null

  const entries = await fs.readdir(themeAbs).catch(() => [] as string[])
  const cssFiles = entries.filter((f) => f.endsWith('.css'))

  const palettePresent = cssFiles.includes('palette.css')
  const variants: ThemeVariant[] = await Promise.all(
    cssFiles
      .filter((f) => f !== 'palette.css' && variantNameFromFile(f))
      .map(async (f) => {
        const variantName = variantNameFromFile(f)!
        const cssPath = `${themeRel}/${f}`
        const guidePath = cssPath.replace(/\.css$/, '.html')
        const [cssOk, guideOk] = await Promise.all([
          exists(join(rootPath, cssPath), 'file'),
          exists(join(rootPath, guidePath), 'file'),
        ])
        return { name: variantName, cssPath, cssExists: cssOk, guideExists: guideOk, guidePath }
      }),
  )

  if (!palettePresent && variants.length === 0) return null

  variants.sort((a, b) => compareAssetName(a.name, b.name))

  const paletteCssPath = `${themeRel}/palette.css`
  const paletteGuidePath = `${themeRel}/palette.html`
  const paletteGuideExists = palettePresent
    ? await exists(join(rootPath, paletteGuidePath), 'file')
    : false

  return {
    name: libraryName,
    path: themeRel,
    palette: {
      cssPath: paletteCssPath,
      cssExists: palettePresent,
      guidePath: paletteGuidePath,
      guideExists: paletteGuideExists,
    },
    variants,
  }
}

async function listComponentDemoPaths(
  rootPath: string,
  componentRel: string,
  currentRel = componentRel
): Promise<string[]> {
  const entries = await fs.readdir(join(rootPath, currentRel), { withFileTypes: true }).catch(() => [])
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const childRel = `${currentRel}/${entry.name}`
    if (entry.isDirectory()) {
      paths.push(...await listComponentDemoPaths(rootPath, componentRel, childRel))
    } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      paths.push(childRel)
    }
  }
  return paths.sort(compareAssetName)
}

// 扫单个资产库内的组件目录（除 theme/ 外的子目录），列出全部 HTML 效果。
async function scanLibraryComponents(rootPath: string, libraryRel: string): Promise<AssetComponent[]> {
  const libAbs = join(rootPath, libraryRel)
  const entries = await fs.readdir(libAbs, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'theme')
  const components = await Promise.all(
    dirs.map(async (e) => {
      const compRel = `${libraryRel}/${e.name}`
      const demoPaths = await listComponentDemoPaths(rootPath, compRel)
      const demoPath = demoPaths.find((path) => /^index\.html?$/i.test(path.slice(compRel.length + 1)))
        ?? demoPaths[0]
        ?? null
      return {
        name: e.name,
        path: compRel,
        hasDemo: demoPaths.length > 0,
        demoPath,
        demoPaths
      }
    }),
  )
  components.sort((a, b) => compareAssetName(a.name, b.name))
  return components
}

// 列举 components/ 下所有二级目录作为资产库。
export async function listAssetLibraries(rootPath: string): Promise<AssetLibrary[]> {
  const compAbs = join(rootPath, 'components')
  const entries = await fs.readdir(compAbs, { withFileTypes: true }).catch(() => [])
  const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  const libraries = await Promise.all(
    subdirs.map(async (e) => {
      const libraryRel = `components/${e.name}`
      const [theme, components] = await Promise.all([
        scanLibraryTheme(rootPath, libraryRel, e.name),
        scanLibraryComponents(rootPath, libraryRel),
      ])
      return { name: e.name, path: libraryRel, theme, components }
    }),
  )
  libraries.sort((a, b) => compareAssetName(a.name, b.name))
  return libraries
}
