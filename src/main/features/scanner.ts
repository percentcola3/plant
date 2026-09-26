// PM 项目「features」扫描器（2026-06-24 重构，取代 requirements 模型）。
//
// 目录结构：
//   features/<slug>/                      ← 扁平 feature
//     doc/prd.md | prd.md | README.md     ← PRD 文档（可选）
//     index.html                          ← UI 主产物（可选）
//     v2/index.html                       ← UI 版本子目录（可选）
//     assets/                             ← 资产
//   features/<group>/<slug>/              ← 一级分组
//
// 一个目录被识别为 feature 的条件：含约定文档（doc/prd.md / prd.md / README.md）、
// doc/ 下任意 markdown，或含 .html。
// 否则视为 group 容器（继续向下递归一层）。
//
// 不递归超过 2 层（features/<group>/<slug>/）。<slug>/ 内部 .html 由 collectUiArtifacts 处理。

import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import type { FeatureCard, FeatureUiArtifact, FeaturePublishRecord } from '@shared/types'
import { gitFor } from '../git/client'

const FEATURES_DIR = 'features'
const PRD_FILE_CANDIDATES = ['doc/prd.md', 'prd.md', 'README.md', 'readme.md'] as const
const DOC_MARKDOWN_RE = /\.(md|mdx|markdown)$/i

type DirEntry = { name: string; isFile: boolean; isDir: boolean }

async function readEntries(absPath: string): Promise<DirEntry[]> {
  const entries = await fs.readdir(absPath, { withFileTypes: true }).catch(() => null)
  if (!entries) return []
  return entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => ({ name: e.name, isFile: e.isFile(), isDir: e.isDirectory() }))
}

async function fileExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then((s) => s.isFile()).catch(() => false)
}

async function dirExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then((s) => s.isDirectory()).catch(() => false)
}

async function readModifiedAtRecursive(absPath: string): Promise<string | null> {
  let latest = 0
  async function walk(p: string): Promise<void> {
    const stat = await fs.stat(p).catch(() => null)
    if (!stat) return
    if (stat.isFile()) {
      const t = stat.mtimeMs
      if (t > latest) latest = t
      return
    }
    if (stat.isDirectory()) {
      const entries = await fs.readdir(p).catch(() => [] as string[])
      for (const e of entries) {
        if (e.startsWith('.')) continue
        await walk(join(p, e))
      }
    }
  }
  await walk(absPath)
  return latest > 0 ? new Date(latest).toISOString() : null
}

async function findDocMarkdown(featureAbs: string, featureRelPath: string): Promise<string | null> {
  const entries = await readEntries(join(featureAbs, 'doc'))
  const markdown = entries
    .filter((entry) => entry.isFile && DOC_MARKDOWN_RE.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return markdown[0] ? `${featureRelPath}/doc/${markdown[0].name}` : null
}

// 在 feature 根目录下识别文档。约定名优先，否则用 doc/ 下任意 markdown。
async function findPrdFile(workspacePath: string, featureRelPath: string): Promise<string | null> {
  const featureAbs = join(workspacePath, featureRelPath)
  for (const cand of PRD_FILE_CANDIDATES) {
    if (await fileExists(join(featureAbs, cand))) {
      return `${featureRelPath}/${cand}`
    }
  }
  return findDocMarkdown(featureAbs, featureRelPath)
}

// 收集 feature 内的 UI 产物：根目录 index.html + 一级子目录里的 index.html。
// 命名：根目录的叫 'main'；子目录的取目录名。
async function collectUiArtifacts(workspacePath: string, featureRelPath: string): Promise<FeatureUiArtifact[]> {
  const featureAbs = join(workspacePath, featureRelPath)
  const artifacts: FeatureUiArtifact[] = []

  // 根 index.html
  if (await fileExists(join(featureAbs, 'index.html'))) {
    artifacts.push({
      name: 'main',
      htmlRelPath: `${featureRelPath}/index.html`,
      rootRelPath: featureRelPath,
    })
  }

  // 一级子目录里的 index.html
  const entries = await readEntries(featureAbs)
  for (const entry of entries) {
    if (!entry.isDir) continue
    const subAbs = join(featureAbs, entry.name)
    if (await fileExists(join(subAbs, 'index.html'))) {
      artifacts.push({
        name: entry.name,
        htmlRelPath: `${featureRelPath}/${entry.name}/index.html`,
        rootRelPath: `${featureRelPath}/${entry.name}`,
      })
    }
  }

  return artifacts
}

// 一个目录是不是「feature」而非「group 容器」：含约定文档、doc/ 下 markdown，或 html。
async function looksLikeFeature(
  absPath: string,
  options: { includeNestedIndexHtml: boolean } = { includeNestedIndexHtml: true },
): Promise<boolean> {
  for (const cand of PRD_FILE_CANDIDATES) {
    if (await fileExists(join(absPath, cand))) return true
  }
  if (await findDocMarkdown(absPath, '')) return true
  const entries = await readEntries(absPath)
  for (const entry of entries) {
    if (entry.isFile && /\.html?$/i.test(entry.name)) return true
    // 一级子目录里的 index.html 也算
    if (options.includeNestedIndexHtml && entry.isDir && await fileExists(join(absPath, entry.name, 'index.html'))) return true
  }
  return false
}

async function readPublishRecord(workspacePath: string, featureRelPath: string): Promise<FeaturePublishRecord | null> {
  const p = join(workspacePath, featureRelPath, '.publish.json')
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || !parsed) return null
    if (typeof parsed.url !== 'string' || typeof parsed.publishedAt !== 'string') return null
    return parsed as unknown as FeaturePublishRecord
  } catch {
    return null
  }
}

function isFeaturePublishMetaPath(path: string, featureRelPath: string): boolean {
  return path.replace(/\\/g, '/') === `${featureRelPath}/.publish.json`
}

async function readPublishStale(
  workspacePath: string,
  featureRelPath: string,
  publish: FeaturePublishRecord | null
): Promise<boolean> {
  const publishedHead = publish?.headSha?.trim()
  if (!publishedHead) return false
  const sg = gitFor(workspacePath)
  const currentHead = await sg.revparse(['HEAD']).then((s) => s.trim()).catch(() => '')
  if (!currentHead || currentHead === publishedHead) return false

  const changed = await sg
    .raw(['diff', '--name-only', `${publishedHead}..HEAD`, '--', featureRelPath])
    .catch(() => '')
  return changed
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => !isFeaturePublishMetaPath(p, featureRelPath))
}

async function buildFeatureCard(
  workspacePath: string,
  featureRelPath: string,
  group: string | null,
): Promise<FeatureCard> {
  const name = featureRelPath.split('/').pop() ?? featureRelPath
  const featureAbs = join(workspacePath, featureRelPath)
  const [prdRelPath, uiArtifacts, modifiedAt, publish] = await Promise.all([
    findPrdFile(workspacePath, featureRelPath),
    collectUiArtifacts(workspacePath, featureRelPath),
    readModifiedAtRecursive(featureAbs),
    readPublishRecord(workspacePath, featureRelPath),
  ])
  const publishStale = await readPublishStale(workspacePath, featureRelPath, publish)
  return { name, relPath: featureRelPath, group, prdRelPath, uiArtifacts, modifiedAt, publish, publishStale }
}

// 主入口：扫描 <workspace>/features/ 返回所有 feature card。
export async function listFeatures(workspacePath: string): Promise<FeatureCard[]> {
  const featuresAbs = join(workspacePath, FEATURES_DIR)
  if (!(await dirExists(featuresAbs))) return []

  const level1 = await readEntries(featuresAbs)
  const features: FeatureCard[] = []

  for (const entry of level1) {
    if (!entry.isDir) continue
    const level1Abs = join(featuresAbs, entry.name)
    if (await looksLikeFeature(level1Abs, { includeNestedIndexHtml: false })) {
      // 扁平 feature：features/<slug>/
      features.push(await buildFeatureCard(workspacePath, `${FEATURES_DIR}/${entry.name}`, null))
      continue
    }
    // 一级目录不是 feature → 视作 group 容器，扫第二层
    const level2 = await readEntries(level1Abs)
    for (const sub of level2) {
      if (!sub.isDir) continue
      const subAbs = join(level1Abs, sub.name)
      if (await looksLikeFeature(subAbs)) {
        features.push(await buildFeatureCard(
          workspacePath,
          `${FEATURES_DIR}/${entry.name}/${sub.name}`,
          entry.name,
        ))
      }
      // 三级嵌套不识别（按 plan 决策：only 一级 group）
    }
  }

  // 按修改时间倒序
  features.sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
  return features
}

export async function listFeatureGroups(workspacePath: string): Promise<string[]> {
  const featuresAbs = join(workspacePath, FEATURES_DIR)
  if (!(await dirExists(featuresAbs))) return []

  const groups: string[] = []
  const level1 = await readEntries(featuresAbs)
  for (const entry of level1) {
    if (!entry.isDir) continue
    const level1Abs = join(featuresAbs, entry.name)
    if (await looksLikeFeature(level1Abs, { includeNestedIndexHtml: false })) continue
    groups.push(entry.name)
  }
  return groups.sort()
}

// 辅助：把绝对路径或路径段规范化为 features 内的相对路径，校验越界。
// IPC 层调用 lifecycle 时用，防止 ../../escape。
export function assertFeatureRelPath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized.startsWith(`${FEATURES_DIR}/`)) {
    throw new Error(`feature path must start with "${FEATURES_DIR}/", got: ${input}`)
  }
  const segments = normalized.split('/')
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    throw new Error(`invalid feature path: ${input}`)
  }
  if (segments.length < 2 || segments.length > 3) {
    throw new Error(`feature path must be features/<slug> or features/<group>/<slug>: ${input}`)
  }
  return normalized
}

export { FEATURES_DIR }
