import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ActiveThemeSelection } from '@shared/types'
import { UIClientError } from '../ipc/errors'
import { assertCanDelete, assertCanDeleteDirectory } from '../git/authorship'

// styles/theme.css 是激活主题的事实源。约定它含两行：
//   @import "./<group>/palette.css";
//   @import "./<group>/theme-<variant>.css";   (或 theme.css → variant=default)
// 修改激活 = 重写这两行 @import。

const THEME_ENTRY_REL = 'styles/theme.css'

const PALETTE_RE = /@import\s+["']\.\/([\w-]+)\/palette\.css["']/
const THEME_RE = /@import\s+["']\.\/([\w-]+)\/theme(?:-([^"']+?))?\.css["']/

function variantNameFromMatch(m2: string | undefined): string {
  return m2 ?? 'default'
}

export async function readActiveTheme(projectPath: string): Promise<ActiveThemeSelection | null> {
  const path = join(projectPath, THEME_ENTRY_REL)
  let text: string
  try {
    text = await fs.readFile(path, 'utf-8')
  } catch {
    return null
  }
  const palette = text.match(PALETTE_RE)
  const theme = text.match(THEME_RE)
  if (!palette || !theme) return null
  // 两行的 group 应该一致；不一致也以 theme 行为准（@import 顺序前后影响有限）
  return {
    group: theme[1],
    variant: variantNameFromMatch(theme[2])
  }
}

export type SwitchOptions = {
  projectPath: string
  group: string
  variant: string                    // 'default' = theme.css，其它 = theme-<variant>.css
}

export async function switchActiveTheme(opts: SwitchOptions): Promise<void> {
  // 校验目标 group 存在 + palette 存在
  const groupDir = join(opts.projectPath, 'styles', opts.group)
  try {
    const st = await fs.stat(groupDir)
    if (!st.isDirectory()) throw new Error('not a dir')
  } catch {
    throw new UIClientError('THEME_GROUP_NOT_FOUND', `主题组 styles/${opts.group} 不存在`)
  }

  const paletteFile = `palette.css`
  const variantFile = opts.variant === 'default' ? `theme.css` : `theme-${opts.variant}.css`

  // 校验文件存在
  try {
    await fs.access(join(groupDir, paletteFile))
  } catch {
    throw new UIClientError(
      'PALETTE_NOT_FOUND',
      `styles/${opts.group}/${paletteFile} 不存在`
    )
  }
  try {
    await fs.access(join(groupDir, variantFile))
  } catch {
    throw new UIClientError(
      'VARIANT_NOT_FOUND',
      `styles/${opts.group}/${variantFile} 不存在`
    )
  }

  const text = renderThemeEntry(opts.group, opts.variant)
  await fs.mkdir(join(opts.projectPath, 'styles'), { recursive: true })
  await fs.writeFile(join(opts.projectPath, THEME_ENTRY_REL), text, 'utf-8')
}

export type CreateGroupOptions = {
  projectPath: string
  name: string
  withPalette?: boolean
}

export async function createThemeGroup(opts: CreateGroupOptions): Promise<{ relPath: string }> {
  const cleanName = opts.name.trim()
  if (!cleanName) throw new UIClientError('VALIDATION', '项目名不能为空')
  if (cleanName.includes('/') || cleanName.includes('\\') || cleanName.startsWith('.')) {
    throw new UIClientError('VALIDATION', '名称不能含 / \\ 或以点开头')
  }
  const groupAbs = join(opts.projectPath, 'styles', cleanName)
  try {
    await fs.access(groupAbs)
    throw new UIClientError('EXISTS', `项目 ${cleanName} 已存在`)
  } catch (e) {
    if (e instanceof UIClientError) throw e
  }
  await fs.mkdir(groupAbs, { recursive: true })
  if (opts.withPalette !== false) {
    await fs.writeFile(
      join(groupAbs, 'palette.css'),
      `/*
 * palette.css — 原子色盘
 * 在 :root 下定义 --xxx-0..-9 这类色阶变量。
 * 组件不要直接引用这些原子变量，而是引用主题文件里的语义变量。
 */
:root {
  /* 在这里定义色阶变量 */
}
`,
      'utf-8'
    )
  }
  return { relPath: `styles/${cleanName}` }
}

export type CreateThemeOptions = {
  projectPath: string
  group: string
  name: string                         // 'light' / 'dark' / 'g-one-c' 等；'default' 会写成 theme.css
}

export async function createThemeFile(opts: CreateThemeOptions): Promise<{ relPath: string }> {
  const cleanName = opts.name.trim()
  if (!cleanName) throw new UIClientError('VALIDATION', '主题名不能为空')
  if (cleanName.includes('/') || cleanName.includes('\\')) {
    throw new UIClientError('VALIDATION', '名称不能含 / \\')
  }
  const groupAbs = join(opts.projectPath, 'styles', opts.group)
  try {
    const st = await fs.stat(groupAbs)
    if (!st.isDirectory()) throw new Error('not a dir')
  } catch {
    throw new UIClientError('THEME_GROUP_NOT_FOUND', `项目 ${opts.group} 不存在`)
  }
  const fileName = cleanName === 'default' ? 'theme.css' : `theme-${cleanName}.css`
  const targetAbs = join(groupAbs, fileName)
  try {
    await fs.access(targetAbs)
    throw new UIClientError('EXISTS', `${fileName} 已存在`)
  } catch (e) {
    if (e instanceof UIClientError) throw e
  }
  const content = `/*
 * ${fileName} — ${cleanName} 主题
 * 把 palette.css 里的原子色映射为语义变量（--color-brand-* / --color-text-* 等）。
 * 组件只引用语义变量，主题文件层负责"切肤"。
 */
@import "./palette.css";

:root {
  /* 语义变量映射 */
}
`
  await fs.writeFile(targetAbs, content, 'utf-8')
  return { relPath: `styles/${opts.group}/${fileName}` }
}

export type DeleteFileOptions = {
  projectPath: string
  relPath: string                      // styles/<group>/xxx 或 styles/<group>
}

export async function deleteThemeEntry(opts: DeleteFileOptions): Promise<void> {
  const stylesAbs = join(opts.projectPath, 'styles')
  const targetAbs = join(opts.projectPath, opts.relPath)
  // 越界 / 防止干掉 styles 自身
  if (targetAbs === stylesAbs || !targetAbs.startsWith(stylesAbs + '/')) {
    throw new UIClientError('VALIDATION', `不允许的删除路径：${opts.relPath}`)
  }
  // 作者校验：判断目标是文件还是目录，分别走单文件/目录递归校验
  const stat = await fs.stat(targetAbs).catch(() => null)
  if (stat?.isDirectory()) {
    await assertCanDeleteDirectory(opts.projectPath, opts.relPath)
  } else {
    await assertCanDelete(opts.projectPath, opts.relPath)
  }
  await fs.rm(targetAbs, { recursive: true, force: true })
}

export function renderThemeEntry(group: string, variant: string): string {
  const variantFile = variant === 'default' ? 'theme.css' : `theme-${variant}.css`
  return `/*
 * theme.css — 唯一样式入口（由 ui-client 维护）
 *
 * HTML（组件预览 + outputs/<slug>/index.html）只 link 本文件。
 * 切换激活主题：使用 ui-client 软件中的"主题"选择器，App 会重写这两行 @import。
 *
 * 当前激活：${group} · ${variant}
 */

@import "./${group}/palette.css";
@import "./${group}/${variantFile}";
`
}
