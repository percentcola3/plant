// Features lifecycle：在 PM 项目的 features/ 目录下创建 / 删除 / 重命名 / 移动 feature。
//
// 与 personal-space 配合：feature 文件直接 commit 进当前 space/<slug> 分支。
// IPC 层负责 commit 决策（这里只动文件树，不主动 git add/commit）。

import { promises as fs } from 'node:fs'
import { basename, join, dirname, resolve } from 'node:path'
import { FEATURES_DIR, assertFeatureRelPath } from './scanner'
import { ensureFeatureAiLinks } from './ai-links'
import { UIClientError } from '../ipc/errors'
import { sanitizeBranchSegment } from '../git/identity'

// slug 清洗：复用 git branch segment 规则 + 长度限制。
const IMPORT_PRD_FILE_CANDIDATES = ['doc/prd.md', 'prd.md', 'README.md', 'readme.md'] as const

export function sanitizeFeatureSlug(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new UIClientError('VALIDATION', 'feature 名称不能为空')
  const cleaned = sanitizeBranchSegment(trimmed)
  if (!cleaned) throw new UIClientError('VALIDATION', `feature 名称无效：${input}`)
  if (cleaned.length > 80) throw new UIClientError('VALIDATION', 'feature 名称过长（>80 字符）')
  return cleaned
}

function buildFeatureRelPath(slug: string, group: string | null): string {
  const cleanSlug = sanitizeFeatureSlug(slug)
  if (!group) return `${FEATURES_DIR}/${cleanSlug}`
  const cleanGroup = sanitizeFeatureSlug(group)
  return `${FEATURES_DIR}/${cleanGroup}/${cleanSlug}`
}

async function pathExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then(() => true).catch(() => false)
}

async function fileExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then((s) => s.isFile()).catch(() => false)
}

async function assertDirectory(absPath: string, label: string): Promise<void> {
  const stat = await fs.stat(absPath).catch(() => null)
  if (!stat) throw new UIClientError('NOT_FOUND', `${label}不存在：${absPath}`)
  if (!stat.isDirectory()) throw new UIClientError('VALIDATION', `${label}必须是目录：${absPath}`)
}

function shouldCopyImportedEntry(sourceRoot: string, sourcePath: string): boolean {
  if (sourcePath === sourceRoot) return true
  const name = basename(sourcePath)
  return name !== '.git' && name !== 'node_modules' && name !== '.DS_Store'
}

async function assertImportableFeatureSource(sourcePath: string): Promise<void> {
  for (const cand of IMPORT_PRD_FILE_CANDIDATES) {
    if (await fileExists(join(sourcePath, cand))) return
  }
  const entries = await fs.readdir(sourcePath, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isFile() && /\.html?$/i.test(entry.name)) return
    if (entry.isDirectory() && await fileExists(join(sourcePath, entry.name, 'index.html'))) return
  }
  throw new UIClientError('VALIDATION', '导入目录需要包含 PRD/README 或 HTML 产物')
}

export type CreateFeatureInput = {
  workspacePath: string
  slug: string
  group?: string | null
  // 默认 true。仅 false 时跳过 doc/prd.md scaffold（极少用，给从模板装入留口）
  withPrd?: boolean
  withIndexHtml?: boolean
}

export type CreateFeatureResult = {
  featureRelPath: string
  prdRelPath: string | null
  indexHtmlRelPath: string | null
}

// 创建一个新 feature。已存在同名 slug（含 group 路径）则抛 EXISTS。
export async function createFeature(input: CreateFeatureInput): Promise<CreateFeatureResult> {
  const featureRel = buildFeatureRelPath(input.slug, input.group ?? null)
  const featureAbs = join(input.workspacePath, featureRel)
  if (await pathExists(featureAbs)) {
    throw new UIClientError('EXISTS', `feature 已存在：${featureRel}`)
  }
  await fs.mkdir(featureAbs, { recursive: true })

  const withPrd = input.withPrd !== false
  const withIndexHtml = input.withIndexHtml !== false
  const prdRelPath = withPrd ? `${featureRel}/doc/prd.md` : null
  const indexHtmlRelPath = withIndexHtml ? `${featureRel}/index.html` : null
  const slug = featureRel.split('/').pop() ?? featureRel

  if (withPrd) {
    await fs.mkdir(dirname(join(input.workspacePath, prdRelPath!)), { recursive: true })
    await fs.writeFile(
      join(input.workspacePath, prdRelPath!),
      renderPrdScaffold(slug),
      'utf-8',
    )
  }
  if (withIndexHtml) {
    await fs.writeFile(
      join(input.workspacePath, indexHtmlRelPath!),
      renderFeatureIndexScaffold(),
      'utf-8',
    )
  }
  // 2026-06-25：通过符号链接把项目根的 .claude / .agents / CLAUDE.md / AGENTS.md
  // 挂进 feature 目录，让 Claude Code cwd-lock 下能发现项目级 skill + 规则。
  // 根目录唯一事实源；失败不阻塞 feature 落地。
  await ensureFeatureAiLinks(input.workspacePath, featureRel).catch(() => undefined)
  return { featureRelPath: featureRel, prdRelPath, indexHtmlRelPath }
}

export type ImportFeatureInput = {
  workspacePath: string
  sourcePath: string
  slug?: string
  group?: string | null
}

export async function importFeature(input: ImportFeatureInput): Promise<{ featureRelPath: string }> {
  const sourceAbs = resolve(input.sourcePath)
  await assertDirectory(sourceAbs, '导入目录')
  await assertImportableFeatureSource(sourceAbs)

  const featureRel = buildFeatureRelPath(input.slug ?? basename(sourceAbs), input.group ?? null)
  const featureAbs = join(input.workspacePath, featureRel)
  if (await pathExists(featureAbs)) {
    throw new UIClientError('EXISTS', `feature 已存在：${featureRel}`)
  }

  await fs.mkdir(dirname(featureAbs), { recursive: true })
  await fs.cp(sourceAbs, featureAbs, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (sourcePath) => shouldCopyImportedEntry(sourceAbs, sourcePath)
  })
  await fs.rm(join(featureAbs, '.publish.json'), { force: true }).catch(() => undefined)
  await ensureFeatureAiLinks(input.workspacePath, featureRel).catch(() => undefined)
  return { featureRelPath: featureRel }
}

export type DeleteFeatureInput = {
  workspacePath: string
  /** features/<slug> 或 features/<group>/<slug> */
  relPath: string
}

export async function deleteFeature(input: DeleteFeatureInput): Promise<void> {
  const normalized = assertFeatureRelPath(input.relPath)
  const abs = join(input.workspacePath, normalized)
  if (!(await pathExists(abs))) {
    throw new UIClientError('NOT_FOUND', `feature 不存在：${normalized}`)
  }
  await fs.rm(abs, { recursive: true, force: true })
  // 若 group 目录变空，顺手清掉（避免遗留空目录）
  const parent = dirname(abs)
  const grandParent = dirname(parent)
  const featuresAbs = join(input.workspacePath, FEATURES_DIR)
  if (parent !== featuresAbs && grandParent === featuresAbs) {
    const entries = await fs.readdir(parent).catch(() => [] as string[])
    if (entries.filter((e) => !e.startsWith('.')).length === 0) {
      await fs.rmdir(parent).catch(() => undefined)
    }
  }
}

export type RenameFeatureInput = {
  workspacePath: string
  relPath: string
  newSlug: string
}

export async function renameFeature(input: RenameFeatureInput): Promise<{ relPath: string }> {
  const normalized = assertFeatureRelPath(input.relPath)
  const cleanSlug = sanitizeFeatureSlug(input.newSlug)
  const segments = normalized.split('/')
  segments[segments.length - 1] = cleanSlug
  const newRelPath = segments.join('/')
  if (newRelPath === normalized) return { relPath: normalized }
  const oldAbs = join(input.workspacePath, normalized)
  const newAbs = join(input.workspacePath, newRelPath)
  if (!(await pathExists(oldAbs))) {
    throw new UIClientError('NOT_FOUND', `feature 不存在：${normalized}`)
  }
  if (await pathExists(newAbs)) {
    throw new UIClientError('EXISTS', `目标名已存在：${newRelPath}`)
  }
  await fs.rename(oldAbs, newAbs)
  return { relPath: newRelPath }
}

export type MoveFeatureInput = {
  workspacePath: string
  relPath: string
  /** 目标 group。null = 移到根（features/<slug>）；非空 = 移到 features/<group>/<slug> */
  toGroup: string | null
}

export async function moveFeature(input: MoveFeatureInput): Promise<{ relPath: string }> {
  const normalized = assertFeatureRelPath(input.relPath)
  const slug = normalized.split('/').pop()!
  const targetRel = input.toGroup
    ? `${FEATURES_DIR}/${sanitizeFeatureSlug(input.toGroup)}/${slug}`
    : `${FEATURES_DIR}/${slug}`
  if (targetRel === normalized) return { relPath: normalized }
  const oldAbs = join(input.workspacePath, normalized)
  const newAbs = join(input.workspacePath, targetRel)
  if (!(await pathExists(oldAbs))) {
    throw new UIClientError('NOT_FOUND', `feature 不存在：${normalized}`)
  }
  if (await pathExists(newAbs)) {
    throw new UIClientError('EXISTS', `目标位置已存在 feature：${targetRel}`)
  }
  await fs.mkdir(dirname(newAbs), { recursive: true })
  await fs.rename(oldAbs, newAbs)
  // 清理空的旧 group 目录
  const oldParent = dirname(oldAbs)
  const featuresAbs = join(input.workspacePath, FEATURES_DIR)
  if (oldParent !== featuresAbs) {
    const entries = await fs.readdir(oldParent).catch(() => [] as string[])
    if (entries.filter((e) => !e.startsWith('.')).length === 0) {
      await fs.rmdir(oldParent).catch(() => undefined)
    }
  }
  return { relPath: targetRel }
}

// ── scaffold 模板 ──

function renderPrdScaffold(slug: string): string {
  return `# ${slug}\n\n## 背景\n\n## 目标\n\n## 详细需求\n\n## 关键交互\n\n## 验收标准\n`
}

function renderFeatureIndexScaffold(): string {
  // 空白初始化：页面无任何可见内容（首页「开始构建」不再用对话当目录名/初始文案，
  // 页面内容由 AI 根据对话生成）。保留 REGION 注释供 UI generation skill 接管。
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title></title>
  </head>
  <body>
    <!-- REGION: content -->
  </body>
</html>
`
}
