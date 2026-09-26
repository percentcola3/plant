// PM feature 发布器
//
// 把 features/<slug>/ 下的所有 Markdown 文档 + UI 产物合并发布到 S3 同一 prefix：
//   <tenant>/<workspace>/features/<slug>/<timestamp>/
//     index.html               ← SPA：文档索引主页（侧栏 MD 列表 + 客户端渲染 + 顶部 UI 卡片 + 下载源码）
//     <原 MD 路径>             ← 所有 .md / .mdx / .markdown 原样上传（如 doc/prd.md, CLAUDE.md）
//     ui-<artifact>.html       ← 每个 UI 子页（原 index.html 改名，与资源保持同层级）
//     <原资源相对路径>         ← UI 子页关联资源（CSS/JS/图片/字体），按原相对路径上传，
//                                与 ui-<artifact>.html 同在 prefix 下，相对引用照常工作
//     source.zip               ← 整个 feature 目录的源码包
//
// 与 UX outputs/publish.ts 共享同一套 SPA 模板 / source.zip / changelog 实现。
// 入口 URL = SPA 主页（record.url），用户进入即看到文档列表，UI 通过顶部卡片跳转。

import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { FeaturePublishProgressEvent, FeaturePublishRecord } from '@shared/types'
import {
  PUBLISH_CONFIG,
  contentTypeFor,
  createBucket,
  projectSlug,
  publishSlug,
  buildTimestamp,
  uploadToS3,
} from '../publish/s3'
import { UIClientError } from '../ipc/errors'
import { findExternalRefViolations, injectElementRemarksOverlay } from '../outputs/publish'
import { assertFeatureRelPath } from './scanner'
import { uploadSourceZip } from '../publish/source-zip'
import { collectMarkdownDocs, isPublishMarkdownDoc } from '../publish/markdown-walker'
import {
  collectChangelogEntries,
  readHeadSha,
  readPrevPublishHeadShaFromPublishJson
} from '../publish/changelog'
import { renderPublishIndexHtml } from '../publish/index-html'

const FEATURE_PUBLISH_META = '.publish.json'

type Progress = Omit<FeaturePublishProgressEvent, 'workspaceId'>

async function fileExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then((s) => s.isFile()).catch(() => false)
}

type UiSubPage = {
  /** 显示名（导航卡片文字），如 'main' / 'v2' */
  name: string
  /** 在产物目录内的相对路径，如 'index.html' / 'v2/index.html' */
  relPath: string
  /** 绝对路径 */
  abs: string
  /** 关联资源（同子目录下的非 html、非 md 文件） */
  resources: { abs: string; rel: string }[]
  /** 页面同目录下的元素备注文件 */
  remarks: { abs: string } | null
}

async function readDir(absPath: string): Promise<{ name: string; isFile: boolean; isDir: boolean }[]> {
  const entries = await fs.readdir(absPath, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isFile: e.isFile(), isDir: e.isDirectory() }))
}

async function walkFiles(rootAbs: string): Promise<string[]> {
  const out: string[] = []
  async function walk(p: string): Promise<void> {
    const entries = await fs.readdir(p, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = join(p, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.isFile()) out.push(abs)
    }
  }
  await walk(rootAbs)
  return out
}

async function collectUiSubPages(featureAbs: string): Promise<UiSubPage[]> {
  const pages: UiSubPage[] = []

  // 根目录 index.html → 'main'。资源 = 根下非 html、非 md、非子目录 index 的文件。
  // 排除 .md：它们由 collectMarkdownDocs 单独处理，原样上传到 prefix 根。
  if (await fileExists(join(featureAbs, 'index.html'))) {
    const allFiles = await walkFiles(featureAbs)
    const resources = allFiles
      .filter((abs) => {
        const rel = relative(featureAbs, abs).split(/[\\/]/).join('/')
        if (rel === 'index.html') return false
        if (rel === FEATURE_PUBLISH_META) return false
        if (rel === 'element-remarks.json') return false
        if (isPublishMarkdownDoc(rel)) return false
        // 排除子目录的 index.html（它们是独立子页）
        if (/^[^/]+\/index\.html$/i.test(rel)) return false
        return true
      })
      .map((abs) => ({ abs, rel: relative(featureAbs, abs).split(/[\\/]/).join('/') }))
    const remarksAbs = join(featureAbs, 'element-remarks.json')
    pages.push({
      name: 'main',
      relPath: 'index.html',
      abs: join(featureAbs, 'index.html'),
      resources,
      remarks: await fileExists(remarksAbs) ? { abs: remarksAbs } : null
    })
  }

  // 子目录里的 index.html
  const level1 = await readDir(featureAbs)
  for (const entry of level1) {
    if (!entry.isDir) continue
    const subAbs = join(featureAbs, entry.name)
    const indexAbs = join(subAbs, 'index.html')
    if (!(await fileExists(indexAbs))) continue
    const subFiles = await walkFiles(subAbs)
    const resources = subFiles
      .filter((abs) => {
        const rel = relative(subAbs, abs).split(/[\\/]/).join('/')
        if (rel === 'index.html') return false
        if (rel === 'element-remarks.json') return false
        if (isPublishMarkdownDoc(rel)) return false
        return true
      })
      .map((abs) => ({ abs, rel: `${entry.name}/${relative(subAbs, abs).split(/[\\/]/).join('/')}` }))
    const remarksAbs = join(subAbs, 'element-remarks.json')
    pages.push({
      name: entry.name,
      relPath: `${entry.name}/index.html`,
      abs: indexAbs,
      resources,
      remarks: await fileExists(remarksAbs) ? { abs: remarksAbs } : null
    })
  }

  return pages
}

async function writeRecord(featureAbs: string, record: FeaturePublishRecord): Promise<void> {
  await fs.mkdir(dirname(join(featureAbs, FEATURE_PUBLISH_META)), { recursive: true })
  await fs.writeFile(join(featureAbs, FEATURE_PUBLISH_META), JSON.stringify(record, null, 2) + '\n', 'utf-8')
}

export type PublishFeatureInput = {
  workspacePath: string
  workspaceName: string
  featureRelPath: string
  onProgress?: (event: Progress) => void
}

export async function publishFeature(input: PublishFeatureInput): Promise<FeaturePublishRecord> {
  const featureRel = assertFeatureRelPath(input.featureRelPath)
  const featureAbs = join(input.workspacePath, featureRel)
  const stat = await fs.stat(featureAbs).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new UIClientError('NOT_FOUND', `feature 不存在：${featureRel}`)
  }

  const emit = (event: Progress): void => { input.onProgress?.(event) }
  emit({ featureRelPath: featureRel, phase: 'preparing', uploaded: 0, total: 0 })

  // 1) 扫文件 + 收集 MD 文档 + UI 子页
  const allFeatureFiles = await walkFiles(featureAbs)
  emit({ featureRelPath: featureRel, phase: 'rendering-md', uploaded: 0, total: 0 })
  const markdownDocs = await collectMarkdownDocs(featureAbs, allFeatureFiles)
  emit({ featureRelPath: featureRel, phase: 'collecting-ui', uploaded: 0, total: 0 })
  const uiPages = await collectUiSubPages(featureAbs)
  if (markdownDocs.length === 0 && uiPages.length === 0) {
    throw new UIClientError('NO_CONTENT', `feature ${basename(featureRel)} 既无文档也无 UI 产物，无法发布`)
  }

  // 2) .external/ 引用校验（同 UX 行为，命中即阻断）
  const externalRefs = await findExternalRefViolations(featureAbs, allFeatureFiles)
  if (externalRefs.length > 0) {
    const list = externalRefs.slice(0, 5).map((v) => `${v.relPath}: ${v.snippet}`).join('；')
      + (externalRefs.length > 5 ? ` 等 ${externalRefs.length} 处` : '')
    throw new UIClientError(
      'EXTERNAL_REF_IN_PRODUCT',
      `feature 里有 ${externalRefs.length} 处引用了 .external/（只读资产库，不随发布）。请把对应资源复制进 feature 目录并改成项目内相对路径后重试：${list}`
    )
  }

  // 3) prefix + changelog
  const prefix = [
    PUBLISH_CONFIG.tenant,
    projectSlug(input.workspaceName),
    'features',
    publishSlug(basename(featureRel)),
    buildTimestamp(),
  ].join('/')

  const headSha = await readHeadSha(input.workspacePath)
  const oldHeadSha = await readPrevPublishHeadShaFromPublishJson(featureAbs)
  const changelogEntries = oldHeadSha
    ? await collectChangelogEntries(input.workspacePath, oldHeadSha, headSha)
    : []

  // 4) 计算 upload 总数：source.zip + SPA root index + 每个 MD + 每个 UI 子页 html + 子页资源 + 备注 JSON
  const totalUiResources = uiPages.reduce((acc, p) => acc + p.resources.length, 0)
  const totalRemarkFiles = uiPages.filter((p) => p.remarks).length
  const total = 1 /* source.zip */ + 1 /* SPA root */ + markdownDocs.length + uiPages.length + totalUiResources + totalRemarkFiles
  let uploaded = 0
  const bucket = await createBucket()

  // 5) source.zip 优先上传，让 SPA 主页能拿到下载链接
  emit({ featureRelPath: featureRel, phase: 'zipping', uploaded, total })
  emit({ featureRelPath: featureRel, phase: 'uploading', uploaded, total, currentFile: 'source.zip' })
  const { zipUrl } = await uploadSourceZip({ bucket, prefix, rootDir: featureAbs, files: allFeatureFiles })
  uploaded += 1

  // 6) 上传所有 Markdown 文档（原样，按相对路径）
  for (const doc of markdownDocs) {
    const key = `${prefix}/${doc.relPath}`
    emit({ featureRelPath: featureRel, phase: 'uploading', uploaded, total, currentFile: doc.relPath })
    await uploadToS3(bucket, key, join(featureAbs, doc.relPath), contentTypeFor(doc.relPath))
    uploaded += 1
  }

  // 7) 上传每个 UI 子页 html + 关联资源
  for (const page of uiPages) {
    const id = `ui-${page.name}`
    const remarksHref = `${id}-element-remarks.json`
    emit({ featureRelPath: featureRel, phase: 'uploading', uploaded, total, currentFile: `${id}.html` })
    const html = await fs.readFile(page.abs, 'utf-8')
    const injected = injectElementRemarksOverlay(html, {
      sourceRelPath: `${featureRel}/${page.relPath}`,
      publishedRelPath: `${id}.html`,
      remarksHref
    })
    await uploadToS3(bucket, `${prefix}/${id}.html`, Buffer.from(injected, 'utf-8'), 'text/html; charset=utf-8')
    uploaded += 1
    if (page.remarks) {
      emit({ featureRelPath: featureRel, phase: 'uploading', uploaded, total, currentFile: remarksHref })
      await uploadToS3(bucket, `${prefix}/${remarksHref}`, page.remarks.abs, contentTypeFor(page.remarks.abs))
      uploaded += 1
    }
    for (const resource of page.resources) {
      // 按原相对路径上传到 prefix 下（与 HTML 同层级），HTML 里的相对引用照常工作。
      // 不能塞进 `<id>-assets/` 子前缀——否则 HTML 写 `./assets/x.css` 会解析到
      // `<prefix>/assets/x.css`，但资源实际在 `<prefix>/<id>-assets/assets/x.css`，
      // 相对层级被打破，CSS/JS/图片全部 404，页面无样式。与 outputs/publish.ts 对齐。
      const key = `${prefix}/${resource.rel}`
      emit({ featureRelPath: featureRel, phase: 'uploading', uploaded, total, currentFile: resource.rel })
      await uploadToS3(bucket, key, resource.abs, contentTypeFor(resource.abs))
      uploaded += 1
    }
  }

  // 8) 最后生成并上传 SPA 根 index.html
  emit({ featureRelPath: featureRel, phase: 'uploading', uploaded, total, currentFile: 'index.html' })
  const spaHtml = renderPublishIndexHtml({
    title: basename(featureRel),
    markdownDocs,
    uiLinks: uiPages.map((p) => ({ name: p.name, href: `ui-${p.name}.html` })),
    sourceZipUrl: zipUrl,
    changelogEntries
  })
  const navUrl = await uploadToS3(
    bucket,
    `${prefix}/index.html`,
    Buffer.from(spaHtml, 'utf-8'),
    'text/html; charset=utf-8'
  )
  uploaded += 1

  emit({ featureRelPath: featureRel, phase: 'finalizing', uploaded, total })
  const record: FeaturePublishRecord = {
    featureRelPath: featureRel,
    publishedAt: new Date().toISOString(),
    url: navUrl,
    prefix,
    fileCount: uploaded,
    // 字段名沿用旧契约（避免动 shared types）；语义变为「Markdown 文档数」
    prdFileCount: markdownDocs.length,
    uiArtifactCount: uiPages.length,
    bucket: PUBLISH_CONFIG.bucket,
    region: PUBLISH_CONFIG.region,
    ...(headSha ? { headSha } : {}),
  }
  await writeRecord(featureAbs, record)
  emit({ featureRelPath: featureRel, phase: 'completed', uploaded, total })
  return record
}
