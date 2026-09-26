import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import type { DocPublishRecord, DocPublishStatus } from '@shared/types'
import {
  createMarkdownChartHtml,
  createMarkdownDocumentHtml,
  createMermaidInitializeScript
} from '@shared/markdown-document-theme'
import { UIClientError } from '../ipc/errors'
import {
  PUBLISH_CONFIG,
  buildTimestamp,
  contentTypeFor,
  createBucket,
  projectSlug,
  publishSlug,
  uploadToS3
} from '../publish/s3'

const require = createRequire(import.meta.url)
const META_PATH = '.workspace/doc-publish.json'
const PROTECTED_RESOURCE_PREFIXES = ['.git/', '.claude/', '.knowledge/', '.workspace/', '.ui-client/', '.external/', 'node_modules/']

export type MarkdownPublishResource = {
  sourceUrl: string
  absPath: string
  outputPath: string
  contentType: string
  kind: 'image' | 'link'
}

export type MarkdownPublishBundle = {
  html: string
  resources: MarkdownPublishResource[]
  contentHash: string
  imageCount: number
}

type ResourceRef = {
  url: string
  kind: 'image' | 'link'
}

type PublishMeta = {
  records?: Record<string, DocPublishRecord>
}

export async function publishMarkdownDocument(input: {
  workspacePath: string
  workspaceName: string
  relPath: string
}): Promise<DocPublishRecord> {
  const cleanRelPath = normalizeRelPath(input.relPath)
  if (!/\.m(?:d|dx|arkdown)$/i.test(cleanRelPath)) {
    throw new UIClientError('VALIDATION', `只能发布 Markdown 文档：${input.relPath}`)
  }

  const docAbs = resolveInsideWorkspace(input.workspacePath, cleanRelPath)
  const content = await fs.readFile(docAbs, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw new UIClientError('FILE_NOT_FOUND', `文件不存在：${cleanRelPath}`)
    throw err
  })

  const bundle = await buildMarkdownPublishBundle({
    projectPath: input.workspacePath,
    relPath: cleanRelPath,
    content
  })

  const docSlug = publishSlug(cleanRelPath.replace(/\.[^.]+$/, ''))
  const prefix = `${PUBLISH_CONFIG.tenant}/${projectSlug(input.workspaceName)}/docs/${docSlug}/${buildTimestamp()}`
  const bucket = await createBucket()
  const total = bundle.resources.length + 1

  const url = await uploadToS3(
    bucket,
    `${prefix}/index.html`,
    Buffer.from(bundle.html, 'utf-8'),
    'text/html; charset=utf-8'
  )

  for (const resource of bundle.resources) {
    await uploadToS3(bucket, `${prefix}/${resource.outputPath}`, resource.absPath, resource.contentType)
  }

  const record: DocPublishRecord = {
    relPath: cleanRelPath,
    contentHash: bundle.contentHash,
    publishedAt: new Date().toISOString(),
    url,
    prefix,
    fileCount: total,
    imageCount: bundle.imageCount,
    assetCount: bundle.resources.length,
    bucket: PUBLISH_CONFIG.bucket,
    region: PUBLISH_CONFIG.region
  }
  await writeDocPublishRecord(input.workspacePath, record)
  return record
}

export async function buildMarkdownPublishBundle(input: {
  projectPath: string
  relPath: string
  content: string
}): Promise<MarkdownPublishBundle> {
  const resources = await collectLocalResources(input.projectPath, input.relPath, input.content)
  const resourceMap = new Map(resources.map((resource) => [resource.sourceUrl, resource.outputPath]))
  const html = await renderPublishHtml({
    title: basename(input.relPath),
    content: input.content,
    resourceMap
  })

  return {
    html,
    resources,
    contentHash: sha256(input.content),
    imageCount: resources.filter((resource) => resource.kind === 'image').length
  }
}

export async function readDocPublishStatus(
  projectPath: string,
  relPath: string,
  content: string
): Promise<DocPublishStatus | null> {
  const meta = await readPublishMeta(projectPath)
  const record = meta.records?.[normalizeRelPath(relPath)]
  if (!record) return null
  return {
    ...record,
    isPublished: record.contentHash === sha256(content)
  }
}

export async function writeDocPublishRecord(projectPath: string, record: DocPublishRecord): Promise<void> {
  const meta = await readPublishMeta(projectPath)
  const records = { ...(meta.records ?? {}) }
  records[normalizeRelPath(record.relPath)] = record
  const abs = join(projectPath, META_PATH)
  await fs.mkdir(dirname(abs), { recursive: true })
  await fs.writeFile(abs, JSON.stringify({ ...meta, records }, null, 2) + '\n', 'utf-8')
}

async function readPublishMeta(projectPath: string): Promise<PublishMeta> {
  try {
    const raw = await fs.readFile(join(projectPath, META_PATH), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as PublishMeta
  } catch {
    return {}
  }
}

async function collectLocalResources(
  projectPath: string,
  relPath: string,
  content: string
): Promise<MarkdownPublishResource[]> {
  const refs = collectResourceRefs(content)
  const dedup = new Map<string, MarkdownPublishResource>()

  for (const ref of refs) {
    if (dedup.has(ref.url) || !isLocalResourceUrl(ref.url)) continue
    const resource = await resolveLocalResource(projectPath, relPath, ref)
    dedup.set(ref.url, resource)
  }
  return [...dedup.values()]
}

function collectResourceRefs(content: string): ResourceRef[] {
  const markdown = createMarkdownIt()
  const tokens = markdown.parse(content, {})
  const refs: ResourceRef[] = []

  function visit(list: unknown[]): void {
    for (const token of list as Array<{ type: string; children?: unknown[]; attrGet?: (name: string) => string | null }>) {
      if (token.type === 'image') {
        const src = token.attrGet?.('src')
        if (src) refs.push({ url: src, kind: 'image' })
      }
      if (token.type === 'link_open') {
        const href = token.attrGet?.('href')
        if (href) refs.push({ url: href, kind: 'link' })
      }
      if (token.children) visit(token.children)
    }
  }

  visit(tokens)
  return refs
}

async function resolveLocalResource(
  projectPath: string,
  docRelPath: string,
  ref: ResourceRef
): Promise<MarkdownPublishResource> {
  const parsed = splitUrlSuffix(ref.url)
  const decodedPath = decodeURIComponent(parsed.path)
  const docDir = dirname(normalizeRelPath(docRelPath))
  const candidateRel = decodedPath.startsWith('/')
    ? decodedPath.replace(/^\/+/, '')
    : normalizeRelPath(join(docDir, decodedPath))
  const absPath = resolveInsideWorkspace(projectPath, candidateRel)
  const protectedRel = relative(resolve(projectPath), absPath).replace(/\\/g, '/')
  if (PROTECTED_RESOURCE_PREFIXES.some((prefix) => protectedRel === prefix.slice(0, -1) || protectedRel.startsWith(prefix))) {
    throw new UIClientError('PROTECTED_RESOURCE', `资源不可发布：${ref.url}`)
  }

  const stat = await fs.stat(absPath).catch(() => null)
  if (!stat?.isFile()) throw new UIClientError('RESOURCE_NOT_FOUND', `资源不存在：${ref.url}`)
  const bytes = await fs.readFile(absPath)
  const ext = safeOutputExt(absPath)
  return {
    sourceUrl: ref.url,
    absPath,
    outputPath: `assets/${sha256(bytes).slice(0, 12)}${ext}`,
    contentType: contentTypeFor(absPath),
    kind: ref.kind
  }
}

function createMarkdownIt(): MarkdownIt {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : ''
      try {
        return language
          ? hljs.highlight(code, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(code).value
      } catch {
        return escapeHtml(code)
      }
    }
  })
  markdownMarkPlugin(markdown)
  return markdown
}

async function renderPublishHtml(input: {
  title: string
  content: string
  resourceMap: Map<string, string>
}): Promise<string> {
  let hasMermaid = false
  const markdown = createMarkdownIt()
  const originalFence = markdown.renderer.rules.fence
  const originalImage = markdown.renderer.rules.image
  const originalLinkOpen = markdown.renderer.rules.link_open

  markdown.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as { info?: string; content: string }
    const lang = (token.info ?? '').trim().split(/\s+/)[0]
    if (lang === 'mermaid') {
      hasMermaid = true
      return createMarkdownChartHtml(`<pre class="mermaid">${escapeHtml(token.content)}</pre>`)
    }
    return originalFence
      ? originalFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }
  markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = token.attrGet('src')
    if (src && input.resourceMap.has(src)) token.attrSet('src', input.resourceMap.get(src)!)
    return originalImage
      ? originalImage(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }
  markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token.attrGet('href')
    if (href && input.resourceMap.has(href)) token.attrSet('href', input.resourceMap.get(href)!)
    return originalLinkOpen
      ? originalLinkOpen(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }

  const body = markdown.render(input.content)
  return createMarkdownDocumentHtml({
    title: input.title,
    body,
    mermaidScript: hasMermaid ? await mermaidScriptTag() : ''
  })
}

function markdownMarkPlugin(markdown: MarkdownIt): void {
  markdown.inline.ruler.before('emphasis', 'mark', (state: { src: string; pos: number; posMax: number; push: (type: string, tag: string, nesting: number) => { content?: string } }, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x3D || state.src.charCodeAt(state.pos + 1) !== 0x3D) return false
    const start = state.pos + 2
    const end = state.src.indexOf('==', start)
    if (end === -1 || end === start || end > state.posMax) return false
    if (!silent) {
      state.push('mark_open', 'mark', 1)
      const token = state.push('text', '', 0)
      token.content = state.src.slice(start, end)
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })
}

async function mermaidScriptTag(): Promise<string> {
  try {
    const abs = require.resolve('mermaid/dist/mermaid.min.js')
    const script = await fs.readFile(abs, 'utf-8')
    return `<script>${script}</script><script>${createMermaidInitializeScript(true)}</script>`
  } catch {
    return `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><script>${createMermaidInitializeScript(true)}</script>`
  }
}

function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const query = url.indexOf('?')
  const hash = url.indexOf('#')
  const cuts = [query, hash].filter((i) => i >= 0)
  if (cuts.length === 0) return { path: url, suffix: '' }
  const idx = Math.min(...cuts)
  return { path: url.slice(0, idx), suffix: url.slice(idx) }
}

function isLocalResourceUrl(url: string): boolean {
  const { path } = splitUrlSuffix(url)
  if (!path || path.startsWith('#') || path.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false
  return true
}

function resolveInsideWorkspace(projectPath: string, relPath: string): string {
  const root = resolve(projectPath)
  const abs = resolve(root, normalizeRelPath(relPath))
  if (abs !== root && !abs.startsWith(root + '/')) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', `路径越界：${relPath}`)
  }
  return abs
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function safeOutputExt(absPath: string): string {
  const ext = extname(absPath).toLowerCase()
  return /^[.][a-z0-9]+$/.test(ext) ? ext : '.bin'
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
