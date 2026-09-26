import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve, extname } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { WorkspacesStore } from '../workspaces/store'
import { readActiveTheme } from '../projects/theme'
import { applyOutputEdit } from '../preview/applyEdit'
import { injectInspectorIntoHtml } from './inspector-assets'
import {
  buildComponentMachineId,
  buildComponentReadableRef,
  readComponentDoc,
  saveComponentDoc
} from './component-docs'

// 本地静态服务，承载两类路由：
//   /p/<projectId>/<rel>            → 项目内文件（路径越界拒绝）
//   /preview/components/<projectId> → App 内置组件预览页
//   /preview/icons/<projectId>      → App 内置 icon 预览页（T12）
// 浏览器从内置页加载到的项目 css / html 都走 /p/... 同源 URL，避免 CORS。

// 支持的图片格式：svg / png / jpg / jpeg / webp / gif / ico / bmp
export const ICON_EXT_RE = /\.(svg|png|jpe?g|webp|gif|ico|bmp)$/i
export const ICON_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'bmp']

function normalizePreviewRootRel(input: string | null | undefined): string {
  const rel = (input ?? '').replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!rel) return ''
  if (rel.split('/').includes('..')) {
    throw new Error(`path outside project: ${input}`)
  }
  return rel
}

function encodeRelUrl(rel: string): string {
  return rel.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function projectFileBaseUrl(projectId: string, rootRel: string): string {
  const encodedProjectId = encodeURIComponent(projectId)
  return rootRel
    ? `/p/${encodedProjectId}/${encodeRelUrl(rootRel)}/`
    : `/p/${encodedProjectId}/`
}

function prefixPreviewRelPath(rootRel: string, relPath: string): string {
  return rootRel ? `${rootRel}/${relPath}` : relPath
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf'
}

async function resolveAppResource(relPath: string): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(process.cwd(), 'resources', relPath),
    join(here, '..', '..', '..', 'resources', relPath),
    join(here, '..', '..', 'resources', relPath)
  ]
  if (process.resourcesPath) candidates.unshift(join(process.resourcesPath, relPath))
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // try next
    }
  }
  return null
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return null
  return JSON.parse(raw)
}

type PreviewRemark = {
  relPath: string
  path: string
  note: string
  updatedAt?: string
}

type PreviewRemarksFile = {
  version: 1
  items: PreviewRemark[]
}

function normalizePreviewFileRelPath(input: string): string {
  const rel = input.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!rel || isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error(`path outside project: ${input}`)
  }
  return rel
}

function resolvePreviewRemarksFile(projectPath: string, relPath: string): { relPath: string; absPath: string } {
  const cleanRel = normalizePreviewFileRelPath(relPath)
  const dirRel = cleanRel.includes('/') ? cleanRel.replace(/\/[^/]+$/, '') : ''
  const projectAbs = resolve(projectPath)
  const dirAbs = resolve(join(projectAbs, dirRel))
  if (dirAbs !== projectAbs && !dirAbs.startsWith(projectAbs + '/')) {
    throw new Error(`path outside project: ${relPath}`)
  }
  return { relPath: cleanRel, absPath: join(dirAbs, 'element-remarks.json') }
}

async function readPreviewRemarksFile(projectPath: string, relPath: string): Promise<{ relPath: string; absPath: string; data: PreviewRemarksFile }> {
  const resolved = resolvePreviewRemarksFile(projectPath, relPath)
  let data: PreviewRemarksFile = { version: 1, items: [] }
  try {
    const parsed = JSON.parse(await fs.readFile(resolved.absPath, 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const items = Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : []
      data = {
        version: 1,
        items: items
          .map((item): PreviewRemark | null => {
            if (!item || typeof item !== 'object') return null
            const record = item as Record<string, unknown>
            if (
              typeof record.relPath !== 'string' ||
              typeof record.path !== 'string' ||
              typeof record.note !== 'string'
            ) return null
            return {
              relPath: record.relPath,
              path: record.path,
              note: record.note,
              updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined
            }
          })
          .filter((item): item is PreviewRemark => item !== null)
      }
    }
  } catch {
    // No remarks file yet.
  }
  return { ...resolved, data }
}

function formatLocalMinute(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function savePreviewRemark(projectPath: string, relPath: string, selector: string, note: string): Promise<PreviewRemarksFile> {
  const current = await readPreviewRemarksFile(projectPath, relPath)
  const cleanNote = note.trim()
  const items = current.data.items.filter((item) => !(item.relPath === current.relPath && item.path === selector))
  if (cleanNote) {
    items.push({
      relPath: current.relPath,
      path: selector,
      note: cleanNote,
      updatedAt: formatLocalMinute()
    })
  }
  const data: PreviewRemarksFile = { version: 1, items }
  await fs.mkdir(dirname(current.absPath), { recursive: true })
  await fs.writeFile(current.absPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  return {
    version: 1,
    items: data.items.filter((item) => item.relPath === current.relPath)
  }
}

class PreviewServer {
  private server: http.Server | null = null
  private port = 0
  private writeToken = ''
  private store = new WorkspacesStore()

  async start(): Promise<{ port: number; baseUrl: string }> {
    if (this.server) return { port: this.port, baseUrl: `http://127.0.0.1:${this.port}` }
    this.writeToken = randomBytes(24).toString('hex')
    const server = http.createServer(async (req, res) => {
      try {
        await this.handle(req, res)
      } catch (e) {
        res.statusCode = 500
        res.end((e as Error).message)
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('preview server addr invalid')
    this.server = server
    this.port = addr.port
    return { port: this.port, baseUrl: `http://127.0.0.1:${this.port}` }
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((r) => this.server!.close(() => r()))
    this.server = null
    this.port = 0
    this.writeToken = ''
  }

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  token(): string {
    return this.writeToken
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new NodeURL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
    const path = url.pathname

    if (path.startsWith('/p/')) {
      await this.serveProjectFile(path, res)
      return
    }
    if (path.startsWith('/preview/components/')) {
      const projectId = path.slice('/preview/components/'.length)
      await this.serveComponentsPreview(projectId, res, url.searchParams.get('rootRel'))
      return
    }
    if (path.startsWith('/preview/icons/')) {
      const projectId = path.slice('/preview/icons/'.length)
      await this.serveIconsPreview(projectId, res, url.searchParams.get('rootRel'))
      return
    }
    if (path === '/api/icons/semantic' && req.method === 'POST') {
      await this.handleSetIconSemantic(req, res)
      return
    }
    if (path === '/api/components/doc' && req.method === 'GET') {
      await this.handleGetComponentDoc(url, res)
      return
    }
    if (path === '/api/components/doc' && req.method === 'POST') {
      await this.handleSaveComponentDoc(req, res)
      return
    }
    if (path === '/api/project/workspace-lock' && req.method === 'POST') {
      await this.handleWorkspaceLock(req, res)
      return
    }
    if (path === '/api/preview/edit' && req.method === 'POST') {
      await this.handlePreviewEdit(req, res)
      return
    }
    if (path === '/api/preview/remarks' && req.method === 'GET') {
      await this.handleGetPreviewRemarks(url, res)
      return
    }
    if (path === '/api/preview/remarks' && req.method === 'POST') {
      await this.handleSavePreviewRemark(req, res)
      return
    }
    if (path.startsWith('/static/')) {
      await this.serveStatic(path.slice('/static/'.length), res)
      return
    }
    // PM 文档树预览（旧 /preview/md/...）随 docs.* IPC 一起废弃。
    res.statusCode = 404
    res.end()
  }

  // /static/<asset> → 从 node_modules 取（mermaid + highlight.js 主题）
  // 注意：通过 package.json 的 exports 定位 package 根目录，再 join 子路径，
  // 这样能绕开 highlight.js 这类没把 styles/ 挂进 exports 的包。
  private async serveStatic(asset: string, res: http.ServerResponse): Promise<void> {
    // inspector.js / morphdom.js 是 App 自带资源（resources/inspector/）。开发态读源码目录，
    // 打包后由 electron-builder extraResources 复制到 process.resourcesPath/inspector/。
    if (asset === 'inspector.js' || asset === 'morphdom.js') {
      const abs = await resolveAppResource(`inspector/${asset}`)
      if (!abs) {
        res.statusCode = 404
        res.end()
        return
      }
      try {
        const data = await fs.readFile(abs)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(data)
      } catch {
        res.statusCode = 404
        res.end()
      }
      return
    }
    type Spec = { pkg: string; sub: string }
    const map: Record<string, Spec> = {
      'mermaid.min.js': { pkg: 'mermaid', sub: 'dist/mermaid.min.js' },
      'hljs-theme.css': { pkg: 'highlight.js', sub: 'styles/atom-one-light.min.css' }
    }
    const spec = map[asset]
    if (!spec) {
      res.statusCode = 404
      res.end()
      return
    }
    const { dirname: pathDirname, join: pathJoin } = await import('node:path')
    const { createRequire } = await import('node:module')
    const requireFn = createRequire(import.meta.url)
    let abs: string
    try {
      const pkgJsonPath = requireFn.resolve(`${spec.pkg}/package.json`)
      abs = pathJoin(pathDirname(pkgJsonPath), spec.sub)
    } catch {
      res.statusCode = 404
      res.end()
      return
    }
    try {
      const data = await fs.readFile(abs)
      const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      res.statusCode = 200
      res.setHeader('Content-Type', mime)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.end(data)
    } catch {
      res.statusCode = 404
      res.end()
    }
  }

  private async handleSetIconSemantic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.headers['x-token'] !== this.writeToken) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    let body = ''
    await new Promise<void>((r) => {
      req.on('data', (c) => { body += String(c) })
      req.on('end', () => r())
    })
    let payload: { projectId?: string; name?: string; semantic?: string }
    try {
      payload = JSON.parse(body)
    } catch {
      res.statusCode = 400
      res.end('bad json')
      return
    }
    const { projectId, name, semantic } = payload
    if (!projectId || !name || typeof semantic !== 'string') {
      res.statusCode = 400
      res.end('bad payload')
      return
    }
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project')
      return
    }
    const semFile = join(project.path, 'assets/icons/semantics.json')
    let map: Record<string, string> = {}
    try {
      map = JSON.parse(await fs.readFile(semFile, 'utf-8')) as Record<string, string>
    } catch { /* none */ }
    if (semantic) map[name] = semantic
    else delete map[name]
    await fs.mkdir(join(project.path, 'assets/icons'), { recursive: true })
    await fs.writeFile(semFile, JSON.stringify(map, null, 2) + '\n', 'utf-8')
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  }

  private async handleGetComponentDoc(url: NodeURL, res: http.ServerResponse): Promise<void> {
    const projectId = url.searchParams.get('projectId') ?? ''
    const relPath = url.searchParams.get('relPath') ?? ''
    if (!projectId || !relPath) {
      res.statusCode = 400
      res.end('missing projectId or relPath')
      return
    }
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project')
      return
    }
    const doc = await readComponentDoc(project.path, relPath)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(doc))
  }

  private async handleSaveComponentDoc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = ''
    await new Promise<void>((r) => {
      req.on('data', (c) => { body += String(c) })
      req.on('end', () => r())
    })
    let payload: { projectId?: string; relPath?: string; content?: string; token?: string }
    try {
      payload = JSON.parse(body)
    } catch {
      res.statusCode = 400
      res.end('bad json')
      return
    }
    const { projectId, relPath, content, token } = payload
    if (token !== this.writeToken) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    if (!projectId || !relPath || typeof content !== 'string') {
      res.statusCode = 400
      res.end('bad payload')
      return
    }
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project')
      return
    }
    const saved = await saveComponentDoc(project.path, relPath, content)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(saved))
  }

  private async handleWorkspaceLock(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = ''
    await new Promise<void>((r) => {
      req.on('data', (c) => { body += String(c) })
      req.on('end', () => r())
    })
    let payload: { projectId?: string; workspacePath?: string; token?: string }
    try {
      payload = JSON.parse(body)
    } catch {
      res.statusCode = 400
      res.end('bad json')
      return
    }
    const { projectId, workspacePath, token } = payload
    if (token !== this.writeToken) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    if (!projectId || !workspacePath) {
      res.statusCode = 400
      res.end('bad payload')
      return
    }
    // 新模型下"当前激活范围"由 active-requirement（git 分支）控制；
    // inspector 上报的 workspacePath 暂时仅落日志，不再写入 store。R4 重做 inspector 时统一改造。
    void workspacePath
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  }

  private async serveProjectFile(path: string, res: http.ServerResponse): Promise<void> {
    // /p/<id>/<rel>。每段 URL-decode，否则中文/空格文件名（如 "2025 AI 实践总结.png"）
    // 会以 %20%E5... 形式拼到磁盘 join 里，找不到真实文件
    const parts = path.slice('/p/'.length).split('/').map((s) => {
      try { return decodeURIComponent(s) } catch { return s }
    })
    const projectId = parts.shift() ?? ''
    const rel = parts.join('/')
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project not found')
      return
    }
    const projectAbs = resolve(project.path)
    const targetAbs = isAbsolute(rel) ? resolve(rel) : resolve(join(projectAbs, rel))
    if (!targetAbs.startsWith(projectAbs)) {
      res.statusCode = 403
      res.end('path outside project')
      return
    }
    try {
      const ext = extname(targetAbs).toLowerCase()
      const isHtml = ext === '.html' || ext === '.htm'
      const isComponentHtml = isHtml && rel.startsWith('components/')
      const isOutputHtml = isHtml && rel.startsWith('outputs/')
      const isProjectUiHtml = isHtml && /^ui\/.+\.html?$/i.test(rel)
      const isFeatureHtml = isHtml && /^features\/.+\.html?$/i.test(rel)
      const isEditablePreviewHtml = (
        isComponentHtml
        || isOutputHtml
        || isProjectUiHtml
        || isFeatureHtml
      )
      if (isEditablePreviewHtml) {
        const text = await fs.readFile(targetAbs, 'utf-8')
        const withInspector = injectInspectorIntoHtml(text, projectId, rel, this.writeToken, {
          workspacePath: rel.replace(/\/[^/]+$/, ''),
          autoLockWorkspace: true
        })
        const injected = isComponentHtml
          ? injectComponentPreviewAnchors(withInspector, {
              relPath: rel,
              componentId: buildComponentMachineId(rel)
            })
          : withInspector
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(injected)
        return
      }
      const data = await fs.readFile(targetAbs)
      const mime = MIME[ext] ?? 'application/octet-stream'
      res.statusCode = 200
      res.setHeader('Content-Type', mime)
      res.setHeader('Cache-Control', 'no-store')
      res.end(data)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  }

  private async handlePreviewEdit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readJsonBody(req)
    if (!body || typeof body !== 'object') {
      res.statusCode = 400
      res.end('invalid body')
      return
    }
    const { projectId, relPath, token, path: selector, kind, value } = body as Record<string, unknown>
    if (typeof token !== 'string' || token !== this.writeToken) {
      res.statusCode = 403
      res.end('bad token')
      return
    }
    if (
      typeof projectId !== 'string' ||
      typeof relPath !== 'string' ||
      typeof selector !== 'string' ||
      typeof kind !== 'string' ||
      typeof value !== 'string'
    ) {
      res.statusCode = 400
      res.end('missing fields')
      return
    }
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project not found')
      return
    }
    if (!(kind.startsWith('style:') || kind.startsWith('attr:') || kind === 'text:content' || kind === 'node:remove')) {
      res.statusCode = 400
      res.end('bad kind')
      return
    }
    try {
      await applyOutputEdit({
        projectPath: project.path,
        relPath,
        selector,
        kind: kind as `style:${string}` | `attr:${string}` | 'text:content' | 'node:remove',
        value
      })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: msg }))
    }
  }

  private async handleGetPreviewRemarks(url: NodeURL, res: http.ServerResponse): Promise<void> {
    const projectId = url.searchParams.get('projectId') ?? ''
    const relPath = url.searchParams.get('relPath') ?? ''
    if (!projectId || !relPath) {
      res.statusCode = 400
      res.end('missing projectId or relPath')
      return
    }
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project not found')
      return
    }
    try {
      const remarks = await readPreviewRemarksFile(project.path, relPath)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        version: 1,
        items: remarks.data.items.filter((item) => item.relPath === remarks.relPath)
      }))
    } catch (e) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }

  private async handleSavePreviewRemark(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readJsonBody(req)
    if (!body || typeof body !== 'object') {
      res.statusCode = 400
      res.end('invalid body')
      return
    }
    const { projectId, relPath, token, path: selector, note } = body as Record<string, unknown>
    if (typeof token !== 'string' || token !== this.writeToken) {
      res.statusCode = 403
      res.end('bad token')
      return
    }
    if (
      typeof projectId !== 'string' ||
      typeof relPath !== 'string' ||
      typeof selector !== 'string' ||
      typeof note !== 'string'
    ) {
      res.statusCode = 400
      res.end('missing fields')
      return
    }
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project not found')
      return
    }
    try {
      const data = await savePreviewRemark(project.path, relPath, selector, note)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    } catch (e) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }

  private async serveComponentsPreview(projectId: string, res: http.ServerResponse, rootRelInput?: string | null): Promise<void> {
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project not found')
      return
    }
    let rootRel = ''
    try {
      rootRel = normalizePreviewRootRel(rootRelInput)
    } catch (e) {
      res.statusCode = 403
      res.end(e instanceof Error ? e.message : 'bad rootRel')
      return
    }
    const rootPath = rootRel ? join(project.path, rootRel) : project.path
    // 扫 components/ 下所有一级目录，目录名即预览分组。
    const items = await collectComponentHtmls(rootPath)
    const themeGroups = await collectThemeGroups(rootPath)
    const activeTheme = await readActiveTheme(rootPath)
    const baseFile = projectFileBaseUrl(projectId, rootRel)
    const themeCssUrl = baseFile + 'styles/theme.css'
    const readonly = !!rootRel

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(renderComponentsHtml({
      projectName: project.name,
      projectId,
      writeToken: this.writeToken,
      themeCssUrl,
      activeTheme,
      readonly,
      themeGroups: themeGroups.map(g => ({
        name: g.name,
        paletteCssPath: baseFile + g.paletteCssPath,
        variants: g.variants.map(v => ({
          name: v.name,
          cssPath: baseFile + v.cssPath
        }))
      })),
      items: items.map((it) => ({
        name: it.name,
        category: it.category,
        url: baseFile + it.relPath,
        relPath: prefixPreviewRelPath(rootRel, it.relPath),
        componentId: buildComponentMachineId(prefixPreviewRelPath(rootRel, it.relPath)),
        readableRef: buildComponentReadableRef(prefixPreviewRelPath(rootRel, it.relPath)),
        deps: it.deps
      }))
    }))
  }

  private async serveIconsPreview(projectId: string, res: http.ServerResponse, rootRelInput?: string | null): Promise<void> {
    const project = await this.store.findById(projectId)
    if (!project) {
      res.statusCode = 404
      res.end('project not found')
      return
    }
    let rootRel = ''
    try {
      rootRel = normalizePreviewRootRel(rootRelInput)
    } catch (e) {
      res.statusCode = 403
      res.end(e instanceof Error ? e.message : 'bad rootRel')
      return
    }
    const rootPath = rootRel ? join(project.path, rootRel) : project.path
    const baseFile = projectFileBaseUrl(projectId, rootRel)
    const icons = await collectIcons(rootPath)
    const themeCssUrl = baseFile + 'styles/theme.css'
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(renderIconsHtml({
      projectName: project.name,
      projectId,
      writeToken: this.writeToken,
      themeCssUrl,
      readonly: !!rootRel,
      icons: icons.map((i) => ({ name: i.name, url: baseFile + i.relPath, category: i.category, semantic: i.semantic }))
    }))
  }
}

export const previewServer = new PreviewServer()

// ─── 主题组数据（注入到预览页供客户端换肤） ───

type ThemeGroupInfo = {
  name: string
  paletteCssPath: string       // "styles/<group>/palette.css"
  variants: Array<{
    name: string                // "default" | "light" | "g-one-c" 等
    cssPath: string             // "styles/<group>/theme.css" 或 "styles/<group>/theme-light.css"
  }>
}

async function collectThemeGroups(projectPath: string): Promise<ThemeGroupInfo[]> {
  const stylesDir = join(projectPath, 'styles')
  let entries: string[] = []
  try { entries = await fs.readdir(stylesDir) } catch { return [] }

  const groups: ThemeGroupInfo[] = []
  for (const e of entries) {
    if (e.startsWith('.')) continue
    const sub = join(stylesDir, e)
    let st
    try { st = await fs.stat(sub) } catch { continue }
    if (!st.isDirectory()) continue

    const files = await fs.readdir(sub).catch(() => [] as string[])
    const hasPalette = files.includes('palette.css')
    const variantFiles = files.filter(f => {
      if (f === 'palette.css') return false
      return /^theme(?:-.+)?\.css$/.test(f)
    })
    if (!hasPalette && variantFiles.length === 0) continue

    const variants = variantFiles.map(f => {
      const m = f.match(/^theme(?:-(.+))?\.css$/)!
      return { name: m[1] ?? 'default', cssPath: `styles/${e}/${f}` }
    })
    variants.sort((a, b) => a.name.localeCompare(b.name))

    groups.push({
      name: e,
      paletteCssPath: `styles/${e}/palette.css`,
      variants
    })
  }
  groups.sort((a, b) => a.name.localeCompare(b.name))
  return groups
}

// ─── 组件 CSS 依赖检测 ───

type ComponentCssDeps = {
  palette: string | null   // 色盘组名，如 "saas"
  variant: string | null   // 主题变体名，如 "light"、"default"
}

async function detectCssDepsAsync(html: string, projectPath: string): Promise<ComponentCssDeps> {
  const result: ComponentCssDeps = { palette: null, variant: null }

  const linkRe = /<link[^>]+href=["']([^"']*styles\/[^"']*)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) extractFromCssPath(m[1], result)

  const importRe = /@import\s+(?:url\()?\s*["']([^"']*styles\/[^"']*)/gi
  while ((m = importRe.exec(html)) !== null) extractFromCssPath(m[1], result)

  // 如果只引用了全局入口 styles/theme.css，读取解析实际主题
  if (result.palette === null && result.variant === null) {
    const active = await readActiveTheme(projectPath)
    if (active) {
      result.palette = active.group
      result.variant = active.variant
    }
  }

  return result
}

function extractFromCssPath(cssRef: string, result: ComponentCssDeps): void {
  const normalized = cssRef.replace(/\\/g, '/')
  const idx = normalized.indexOf('styles/')
  if (idx === -1) return
  const rel = normalized.slice(idx)       // "styles/saas/palette.css"
  const parts = rel.split('/')
  if (parts.length < 3) return             // "styles/something" — 不够层级

  const group = parts[1]
  const file = parts.slice(2).join('/')

  if (file === 'palette.css') {
    result.palette = group
  } else {
    const vm = file.match(/^theme(?:-(.+))?\.css$/)
    if (vm) {
      result.variant = vm[1] ?? 'default'
      if (result.palette === null) result.palette = group
    }
  }
}

// ─── 组件文件收集 ───

type ComponentItem = {
  name: string
  category: string
  relPath: string
  deps: ComponentCssDeps
}

async function collectComponentHtmls(projectPath: string): Promise<ComponentItem[]> {
  const out: ComponentItem[] = []
  const componentsDir = join(projectPath, 'components')
  let categories: Array<{ name: string; isDirectory: () => boolean }> = []
  try {
    categories = await fs.readdir(componentsDir, { withFileTypes: true })
  } catch { return out }
  for (const cat of categories) {
    if (!cat.isDirectory() || cat.name.startsWith('.')) continue
    const dir = join(componentsDir, cat.name)
    let entries: string[] = []
    try {
      entries = await fs.readdir(dir)
    } catch { continue }
    for (const e of entries) {
      if (e.startsWith('.')) continue
      const subdir = join(dir, e)
      let st
      try { st = await fs.stat(subdir) } catch { continue }
      if (!st.isDirectory()) continue
      // 找子目录里第一个 .html 文件
      let files: string[] = []
      try { files = await fs.readdir(subdir) } catch { continue }
      const html = files.find((f) => f.endsWith('.html'))
      if (html) {
        const htmlContent = await fs.readFile(join(subdir, html), 'utf-8').catch(() => '')
        out.push({
          name: e,
          category: cat.name,
          relPath: `components/${cat.name}/${e}/${html}`,
          deps: await detectCssDepsAsync(htmlContent, projectPath)
        })
      }
    }
  }
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return out
}

type IconItem = { name: string; relPath: string; category: string; semantic?: string }

async function collectIcons(projectPath: string): Promise<IconItem[]> {
  const assetsDir = join(projectPath, 'assets')
  const out: IconItem[] = []

  // 递归扫描 assets/ 下所有图标文件
  async function walk(dir: string, category: string): Promise<void> {
    let entries: string[] = []
    try { entries = await fs.readdir(dir) } catch { return }
    for (const e of entries) {
      if (e.startsWith('.')) continue
      const full = join(dir, e)
      let st
      try { st = await fs.stat(full) } catch { continue }
      if (st.isDirectory()) {
        await walk(full, category ? `${category}/${e}` : e)
      } else if (ICON_EXT_RE.test(e)) {
        out.push({ name: e, relPath: full.slice(projectPath.length + 1), category, semantic: undefined })
      }
    }
  }

  await walk(assetsDir, '')

  // 读取 semantics.json（可能在 assets/ 或 assets/icons/ 下）
  let semantics: Record<string, string> = {}
  for (const semPath of ['assets/semantics.json', 'assets/icons/semantics.json']) {
    try {
      const text = await fs.readFile(join(projectPath, semPath), 'utf-8')
      semantics = { ...semantics, ...(JSON.parse(text) as Record<string, string>) }
    } catch { /* none */ }
  }
  // 读取 icon-registry.json — 支持两种格式：
  // 格式1（我们导入写入的）: { "filename.svg": { purpose: "..." } }
  // 格式2（设计系统标准）: { entries: [{ path: "icons/source/xxx.svg", designName: "添加01", aliases: [...], ... }] }
  try {
    const regText = await fs.readFile(join(assetsDir, 'icons', 'registry', 'icon-registry.json'), 'utf-8')
    const raw = JSON.parse(regText) as Record<string, unknown>
    if (Array.isArray(raw.entries)) {
      // 格式2：entries 数组
      for (const entry of raw.entries as Array<Record<string, unknown>>) {
        const path = String(entry.path ?? '')
        const label = String(entry.designName ?? entry.name ?? '')
        if (!path || !label) continue
        // path 可能是 "icons/source/xxx.svg" 或 "xxx.svg"
        const fileName = path.split('/').pop() ?? path
        if (!semantics[fileName]) semantics[fileName] = label
      }
    } else {
      // 格式1：简单的 { name: { purpose } } 映射
      for (const [name, val] of Object.entries(raw)) {
        const v = val as Record<string, unknown>
        if (typeof v.purpose === 'string' && !semantics[name]) semantics[name] = v.purpose
      }
    }
  } catch { /* none */ }
  for (const item of out) {
    // 按文件名匹配语义
    item.semantic = semantics[item.name] ?? semantics[item.relPath] ?? undefined
  }

  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return out
}

function renderComponentsHtml(opts: {
  projectName: string
  projectId: string
  writeToken: string
  themeCssUrl: string
  activeTheme: { group: string; variant: string } | null
  readonly?: boolean
  themeGroups: Array<{
    name: string
    paletteCssPath: string
    variants: Array<{ name: string; cssPath: string }>
  }>
  items: Array<{
    name: string
    category: string
    url: string
    relPath: string
    componentId: string
    readableRef: string
    deps: { palette: string | null; variant: string | null }
  }>
}): string {
  // 按 category 分组
  const groups: Record<string, Array<{ name: string; url: string; relPath: string }>> = {}
  for (const it of opts.items) {
    if (!groups[it.category]) groups[it.category] = []
    groups[it.category].push({ name: it.name, url: it.url, relPath: it.relPath })
  }
  const itemsJson = JSON.stringify(opts.items)
  const themeGroupsJson = JSON.stringify(opts.themeGroups)
  const activeThemeJson = JSON.stringify(opts.activeTheme)
  const readonlyJson = JSON.stringify(!!opts.readonly)
  const knowledgeHint = opts.readonly
    ? '外部 UI 资产区以只读方式预览。'
    : '在这里维护 AI 可检索的组件说明。保存后会直接回写到组件 html 里。'
  const docPlaceholder = opts.readonly
    ? '只读预览'
    : '这里填写给 AI 检索组件用的说明、变体、状态和使用约束。'
  const embeddedActionsHtml = opts.readonly
    ? '<div class="actions"><button class="btn toggle" id="toggleAll">查看全部</button></div>'
    : ''

  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>组件预览 · ${opts.projectName}</title>
<link rel="stylesheet" href="${opts.themeCssUrl}" />
<style>
  :root {
    color-scheme: light;
    --component-bg: #fffdf3;
    --component-surface: #fffaf0;
    --component-surface-muted: #fbf6e8;
    --component-accent-soft: #eef7e7;
    --component-border: rgba(92, 82, 54, 0.18);
    --component-border-strong: rgba(92, 82, 54, 0.28);
    --component-text: #172414;
    --component-muted: #63705b;
    --component-subtle: #87907f;
    --component-accent: #66a962;
    --component-danger: #d84a3a;
    --component-warning: #b25013;
    --component-canvas: #20211f;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    background: var(--component-bg); color: var(--component-text);
    display: grid;
    grid-template-rows: auto 1fr;
  }
  .topbar {
    padding: 8px 24px 14px;
    border-bottom: 1px solid var(--component-border);
    display: flex; justify-content: space-between; align-items: center;
    background: var(--component-bg);
  }
  .topbar h1 { font-size: 15px; line-height: 1.35; font-weight: 650; margin: 0; color: var(--component-text); }
  .topbar .hint { font-size: 12px; line-height: 1.5; color: var(--component-muted); margin-top: 3px; }
  .topbar .actions { display: flex; gap: 8px; }
  .btn {
    padding: 6px 12px; font-size: 12px;
    background: var(--component-surface); color: var(--component-text); border: 1px solid var(--component-border-strong);
    border-radius: 6px; cursor: pointer;
    transition: background 0.1s;
  }
  .btn:hover { background: var(--component-accent-soft); }
  .btn.primary { background: var(--component-accent); border-color: var(--component-accent); color: white; }
  .btn.primary:hover { background: #579954; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn:disabled:hover { background: var(--component-surface); }
  .btn.toggle.on { background: var(--component-accent); border-color: var(--component-accent); color: white; }
  .btn.ghost { background: var(--component-bg); }

  .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr) 360px; min-height: 0; }
  aside.sidebar {
    border-right: 1px solid var(--component-border); background: var(--component-bg);
    overflow-y: auto; padding: 12px 8px;
  }
  .group {
    margin-bottom: 8px;
    border: 1px solid var(--component-border);
    border-radius: 8px;
    background: var(--component-surface);
    overflow: hidden;
  }
  .group-toggle {
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    border-bottom: 1px solid var(--component-border);
    background: var(--component-surface-muted);
    color: var(--component-muted);
    cursor: pointer;
    text-align: left;
  }
  .group-toggle:hover { background: var(--component-accent-soft); color: var(--component-text); }
  .group-toggle:focus-visible { outline: 1px solid var(--component-accent); outline-offset: -1px; }
  .group.collapsed .group-toggle { border-bottom-color: transparent; }
  .group-name {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .group-count {
    min-width: 24px;
    height: 20px;
    padding: 0 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--component-bg);
    color: var(--component-muted);
    font-size: 11px;
    font-weight: 600;
  }
  .group-chevron {
    width: 14px;
    color: var(--component-subtle);
    font-size: 11px;
    transition: transform 0.12s ease;
  }
  .group:not(.collapsed) .group-chevron { transform: rotate(90deg); }
  .group-items { padding: 6px; }
  .group.collapsed .group-items {
    display: none;
  }
  .item {
    padding: 7px 8px 7px 12px; font-size: 13px; color: var(--component-muted);
    border-radius: 5px; cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 8px;
    transition: background 0.1s, color 0.1s;
  }
  .item:hover { background: var(--component-accent-soft); color: var(--component-text); }
  .item.active { background: var(--component-accent); color: white; }
  .item-name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .item-actions {
    display: inline-flex; align-items: center; gap: 4px;
    opacity: 0; pointer-events: none;
    transition: opacity 0.1s;
  }
  .item:hover .item-actions,
  .item.active .item-actions {
    opacity: 1; pointer-events: auto;
  }
  .item-action {
    height: 22px; padding: 0 6px;
    border: 1px solid var(--component-border); border-radius: 5px;
    background: var(--component-bg); color: var(--component-muted);
    font-size: 11px; cursor: pointer;
  }
  .item-action:hover { border-color: var(--component-border-strong); background: var(--component-accent-soft); }
  .item-action.danger { color: var(--component-danger); }

  main.detail {
    background: var(--component-canvas);
    display: flex; flex-direction: column;
    overflow: hidden;
    position: relative;
  }
  .theme-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 16px;
    border-bottom: 1px solid var(--component-border);
    background: var(--component-surface-muted);
    font-size: 12px;
    flex-shrink: 0;
  }
  .theme-bar.hidden { display: none; }
  .deps-info {
    display: flex; align-items: center; gap: 6px;
  }
  .deps-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 4px;
    background: var(--component-accent-soft); font-size: 11px;
    flex-shrink: 0;
  }
  .deps-text { color: var(--component-muted); font-size: 11px; }
  .deps-text .tag {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    background: var(--component-bg); color: var(--component-muted);
    font-family: 'SF Mono', Menlo, monospace; font-size: 10px;
    margin-left: 4px;
  }
  .deps-text .tag.detected { background: rgba(198,139,27,0.16); color: var(--component-warning); }
  .deps-text .tag.none { background: var(--component-bg); color: var(--component-subtle); }
  .theme-controls { display: flex; align-items: center; gap: 8px; }
  .theme-select-wrap {
    position: relative; display: inline-flex; align-items: center;
  }
  .theme-select {
    appearance: none; -webkit-appearance: none;
    padding: 4px 28px 4px 10px; font-size: 12px;
    background: var(--component-bg); color: var(--component-text);
    border: 1px solid var(--component-border-strong); border-radius: 6px;
    cursor: pointer; line-height: 1.4;
  }
  .theme-select:hover { border-color: var(--component-border-strong); }
  .theme-select:focus { outline: 1px solid var(--component-accent); outline-offset: 0; border-color: var(--component-accent); }
  .theme-select-arrow {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    pointer-events: none; font-size: 8px; color: var(--component-subtle);
  }
  .btn-reset {
    padding: 4px 10px; font-size: 11px;
    background: transparent; color: var(--component-muted);
    border: 1px solid var(--component-border-strong); border-radius: 6px;
    cursor: pointer; transition: all 0.15s;
  }
  .btn-reset:hover { color: var(--component-text); border-color: var(--component-border-strong); background: var(--component-accent-soft); }

  main.detail .frame-wrap {
    flex: 1; min-height: 0; position: relative;
  }
  main.detail .empty {
    height: 100%; display: flex; align-items: center; justify-content: center;
    color: var(--component-subtle); font-size: 13px;
  }
  main.detail iframe {
    width: 100%; height: 100%;
    border: 0; background: white;
    display: block;
  }

  main.grid {
    background: var(--component-canvas);
    overflow-y: auto;
    padding: 20px;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  .card {
    border: 1px solid var(--component-border); border-radius: 8px; overflow: hidden;
    background: var(--component-surface); display: flex; flex-direction: column;
    cursor: pointer; transition: border-color 0.15s;
  }
  .card:hover { border-color: var(--component-accent); }
  .card .card-header {
    padding: 9px 13px; border-bottom: 1px solid var(--component-border);
  }
  .card .meta { font-size: 10px; color: var(--component-subtle); text-transform: uppercase; letter-spacing: 0.06em; }
  .card .name { font-size: 13px; margin-top: 2px; }
  .card iframe { flex: 1; border: 0; min-height: 200px; background: white; pointer-events: none; }

  aside.knowledge {
    border-left: 1px solid var(--component-border);
    background: var(--component-bg);
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .knowledge-header {
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--component-border);
  }
  .knowledge-title {
    font-size: 13px;
    font-weight: 600;
  }
  .knowledge-hint {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--component-muted);
  }
  .knowledge-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 18px 20px;
  }
  .meta-block { margin-bottom: 16px; }
  .meta-label {
    margin-bottom: 6px;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--component-subtle);
  }
  .mono-box {
    border: 1px solid var(--component-border);
    border-radius: 8px;
    background: var(--component-surface);
    padding: 10px 12px;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .knowledge-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 16px;
  }
  #editComponentBtn { grid-column: 1 / -1; }
  .doc-hint {
    margin-bottom: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--component-muted);
  }
  .doc-hint.warn { color: var(--component-warning); }
  .doc-editor {
    width: 100%;
    min-height: 360px;
    resize: vertical;
    border: 1px solid var(--component-border);
    border-radius: 10px;
    padding: 12px;
    background: var(--component-surface);
    color: var(--component-text);
    font-size: 12px;
    line-height: 1.6;
    font-family: 'SF Mono', Menlo, monospace;
    outline: none;
  }
  .doc-editor:focus { outline: 1px solid var(--component-accent); outline-offset: 0; border-color: var(--component-accent); }
  .knowledge-footer {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .status-text {
    font-size: 12px;
    color: var(--component-muted);
  }
  .empty-state {
    color: var(--component-subtle);
    font-size: 12px;
    line-height: 1.7;
  }
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <h1>${opts.projectName} · 组件预览</h1>
      <div class="hint">主题随 styles/theme.css 实时变化 · 共 ${opts.items.length} 个组件</div>
    </div>
    ${embeddedActionsHtml}
  </div>

  <div class="layout">
    <aside class="sidebar">
      ${Object.entries(groups).map(([cat, items]) => `
        <div class="group collapsed" data-category="${escapeHtml(cat)}">
          <button class="group-toggle" type="button" data-category="${escapeHtml(cat)}" aria-expanded="false">
            <span class="group-chevron" aria-hidden="true">›</span>
            <span class="group-name">${escapeHtml(cat.toUpperCase())}</span>
            <span class="group-count">${items.length}</span>
          </button>
          <div class="group-items">
            ${items.map((it) => `
              <div class="item" data-name="${escapeHtml(it.name)}" data-category="${escapeHtml(cat)}" data-url="${escapeHtml(it.url)}">
                <span class="item-name">${escapeHtml(it.name)}</span>
                ${opts.readonly ? '' : `
                  <span class="item-actions">
                    <button type="button" class="item-action" data-item-action="edit" title="编辑组件">编辑</button>
                    <button type="button" class="item-action danger" data-item-action="delete" title="删除组件">删除</button>
                  </span>
                `}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
      ${opts.items.length === 0 ? '<div style="padding: 20px; color: #8e8e93; font-size: 12px;">暂无组件</div>' : ''}
    </aside>

    <main class="detail" id="detail">
      <div class="theme-bar hidden" id="themeBar">
        <div class="deps-info">
          <span class="deps-icon">🎨</span>
          <span class="deps-text">
            依赖
            <span class="tag none" id="depTag">未指定</span>
          </span>
        </div>
        <div class="theme-controls">
          <div class="theme-select-wrap">
            <select id="selTheme" class="theme-select"></select>
            <span class="theme-select-arrow">▼</span>
          </div>
          <button class="btn-reset" id="btnResetTheme">重置</button>
        </div>
      </div>
      <div class="frame-wrap" id="frameWrap">
        ${opts.items.length === 0
          ? '<div class="empty">在 components/ 下按目录分组放组件 html 即会出现</div>'
          : '<iframe id="frame" src="" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>'
        }
      </div>
    </main>

    <aside class="knowledge">
      <div class="knowledge-header">
        <div class="knowledge-title">组件知识</div>
        <div class="knowledge-hint">${knowledgeHint}</div>
      </div>
      <div class="knowledge-body">
        <div class="meta-block">
          <div class="meta-label">组件路径</div>
          <div class="mono-box" id="refReadable">请选择左侧组件</div>
        </div>
        <div class="knowledge-actions">
          <button class="btn ghost" id="copyRefBtn">复制引用</button>
          <button class="btn ghost" id="copyRefDocBtn">复制引用 + 说明</button>
          ${opts.readonly ? '' : '<button class="btn primary" id="editComponentBtn" disabled>编辑组件</button>'}
        </div>
        <div class="meta-block">
          <div class="meta-label">组件说明</div>
          <div class="doc-hint" id="docHint">${knowledgeHint}</div>
          <textarea class="doc-editor" id="docEditor" spellcheck="false" placeholder="${docPlaceholder}" ${opts.readonly ? 'readonly' : ''}></textarea>
          <div class="knowledge-footer">
            ${opts.readonly ? '' : '<button class="btn primary" id="saveDocBtn">保存说明</button>'}
            <span class="status-text" id="docStatus">未加载</span>
          </div>
        </div>
      </div>
    </aside>
  </div>

<script>
const ITEMS = ${itemsJson}
const THEME_GROUPS = ${themeGroupsJson}
const ACTIVE_THEME = ${activeThemeJson}
const PROJECT_ID = ${JSON.stringify(opts.projectId)}
const WRITE_TOKEN = ${JSON.stringify(opts.writeToken)}
const READONLY = ${readonlyJson}
const detail = document.getElementById('detail')
const frameWrap = document.getElementById('frameWrap')
const toggleAll = document.getElementById('toggleAll')
const themeBar = document.getElementById('themeBar')
const refReadable = document.getElementById('refReadable')
const docEditor = document.getElementById('docEditor')
const docHint = document.getElementById('docHint')
const docStatus = document.getElementById('docStatus')
const editComponentBtn = document.getElementById('editComponentBtn')

let currentItem = null
let currentDocSource = 'none'
let currentMode = 'detail'

const overrides = new Map()

function overrideKey(name, category) { return category + '/' + name }

function getCurrentOverride(name, category) {
  return overrides.get(overrideKey(name, category)) || null
}

function buildThemeList() {
  var list = [{ label: '(项目默认)', group: '', variant: '', paletteCssPath: '', themeCssPath: '' }]
  THEME_GROUPS.forEach(function(g) {
    g.variants.forEach(function(v) {
      var label = g.name + '/' + v.name
      list.push({ label: label, group: g.name, variant: v.name, paletteCssPath: g.paletteCssPath, themeCssPath: v.cssPath })
    })
  })
  return list
}
var THEME_LIST = buildThemeList()

function populateSelects() {
  var sel = document.getElementById('selTheme')
  if (!sel) return
  sel.innerHTML = THEME_LIST.map(function(t) {
    return '<option value="' + escapeHtml(t.group + '/' + t.variant) + '">' + escapeHtml(t.label) + '</option>'
  }).join('')
  sel.onchange = function() { applyThemeOverride() }
}

function injectThemeIntoIframe(iframe, themeValue) {
  var doc = iframe.contentDocument
  if (!doc || !doc.head) return

  // remove previously injected links
  doc.querySelectorAll('link[data-injected-theme]').forEach(function(el) { el.remove() })

  if (!themeValue) return  // empty = project default, don't inject

  var entry = THEME_LIST.find(function(t) { return t.group + '/' + t.variant === themeValue })
  if (!entry) return

  // inject palette
  var pl = doc.createElement('link')
  pl.rel = 'stylesheet'
  pl.href = entry.paletteCssPath
  pl.setAttribute('data-injected-theme', '')
  doc.head.appendChild(pl)

  // inject theme variant
  var vl = doc.createElement('link')
  vl.rel = 'stylesheet'
  vl.href = entry.themeCssPath
  vl.setAttribute('data-injected-theme', '')
  doc.head.appendChild(vl)
}

function setDocStatus(text, isError) {
  if (!docStatus) return
  docStatus.textContent = text
  docStatus.style.color = isError ? '#d11a2a' : '#6e6e73'
}

function setKnowledgePlaceholder(text) {
  currentItem = null
  currentDocSource = 'none'
  if (editComponentBtn) editComponentBtn.disabled = true
  if (refReadable) refReadable.textContent = text
  if (docEditor) docEditor.value = ''
  if (docHint) {
    docHint.textContent = READONLY
      ? '外部 UI 资产区以只读方式预览。'
      : '说明内容来自组件源码注释。首次保存旧注释时，会迁移成 WorkSpace 受管块。'
    docHint.className = 'doc-hint'
  }
  setDocStatus(READONLY ? '只读' : '未加载')
}

function findGroup(category) {
  return Array.from(document.querySelectorAll('.group')).find(function(el) {
    return el.dataset.category === category
  }) || null
}

function setGroupCollapsed(category, collapsed) {
  var group = findGroup(category)
  if (!group) return
  group.classList.toggle('collapsed', collapsed)
  var toggle = group.querySelector('.group-toggle')
  if (toggle) toggle.setAttribute('aria-expanded', String(!collapsed))
}

function collapseAllGroups() {
  document.querySelectorAll('.group').forEach(function(group) {
    var category = group.dataset.category
    if (category) setGroupCollapsed(category, true)
  })
}

function toggleGroup(category) {
  var group = findGroup(category)
  if (!group) return
  setGroupCollapsed(category, !group.classList.contains('collapsed'))
}

function showEmptyDetail(text) {
  currentMode = 'detail'
  detail.className = 'detail'
  if (themeBar) themeBar.classList.add('hidden')
  if (toggleAll) toggleAll.classList.remove('on')
  frameWrap.innerHTML = '<div class="empty">' + escapeHtml(text) + '</div>'
}

async function loadComponentDoc(item) {
  if (!docEditor) return
  setDocStatus('加载中…')
  try {
    const url = '/api/components/doc?projectId=' + encodeURIComponent(PROJECT_ID) + '&relPath=' + encodeURIComponent(item.relPath)
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    currentDocSource = data.source || 'none'
    docEditor.value = data.content || ''
    if (READONLY) {
      if (docHint) {
        docHint.textContent = currentDocSource === 'none'
          ? '当前组件没有说明。'
          : '说明内容来自组件源码注释，只读预览不会写回。'
        docHint.className = 'doc-hint'
      }
      setDocStatus(currentDocSource === 'none' ? '无说明' : '已加载')
      return
    }
    if (docHint) {
      if (currentDocSource === 'legacy') {
        docHint.textContent = '当前说明来自旧普通注释。首次保存后会迁移成 WorkSpace 受管说明块。'
        docHint.className = 'doc-hint warn'
      } else if (currentDocSource === 'none') {
        docHint.textContent = '当前组件还没有说明。保存后会在组件 html 头部插入受管说明块。'
        docHint.className = 'doc-hint'
      } else {
        docHint.textContent = '当前说明已经由 WorkSpace 受管，保存后会直接回写到组件源码。'
        docHint.className = 'doc-hint'
      }
    }
    setDocStatus(currentDocSource === 'none' ? '可新增说明' : '已加载')
  } catch (e) {
    setDocStatus('读取失败', true)
    if (docHint) {
      docHint.textContent = e instanceof Error ? e.message : String(e)
      docHint.className = 'doc-hint warn'
    }
  }
}

function buildReferencePayload(item) {
  return item.readableRef + '\\n' + item.componentId
}

function componentDirFromRelPath(relPath) {
  var parts = String(relPath || '').split('/')
  parts.pop()
  return parts.join('/')
}

function postEditComponent(item) {
  if (!item || READONLY) return
  window.parent.postMessage({
    type: '__uikit_open_component_editor__',
    projectId: PROJECT_ID,
    relPath: item.relPath,
    componentPath: componentDirFromRelPath(item.relPath),
    title: item.name
  }, '*')
}

function openCurrentComponentEditor() {
  postEditComponent(currentItem)
}

function deleteCurrentComponent(item) {
  if (!item || READONLY) return
  window.parent.postMessage({
    type: '__uikit_delete_component__',
    projectId: PROJECT_ID,
    relPath: item.relPath,
    componentPath: componentDirFromRelPath(item.relPath),
    title: item.name
  }, '*')
}

function copyText(text, successText) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      setDocStatus(successText || '已复制')
    }).catch(function() {
      fallbackCopy(text)
      setDocStatus(successText || '已复制')
    })
    return
  }
  fallbackCopy(text)
  setDocStatus(successText || '已复制')
}

function fallbackCopy(text) {
  var textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

async function saveCurrentDoc() {
  if (!currentItem || !docEditor) return
  if (READONLY) {
    setDocStatus('只读预览')
    return
  }
  setDocStatus('保存中…')
  try {
    const res = await fetch('/api/components/doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        relPath: currentItem.relPath,
        content: docEditor.value,
        token: WRITE_TOKEN
      })
    })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    currentDocSource = data.source || 'managed'
    if (docHint) {
      docHint.textContent = '当前说明已经由 WorkSpace 受管，保存后会直接回写到组件源码。'
      docHint.className = 'doc-hint'
    }
    setDocStatus('已保存')
  } catch (e) {
    setDocStatus('保存失败', true)
    if (docHint) {
      docHint.textContent = e instanceof Error ? e.message : String(e)
      docHint.className = 'doc-hint warn'
    }
  }
}

function applyThemeOverride() {
  var frame = document.getElementById('frame')
  var sel = document.getElementById('selTheme')
  var active = document.querySelector('.item.active')
  if (!frame || !active || !sel) return

  var value = sel.value  // "group/variant" or "" for project default
  var key = overrideKey(active.dataset.name, active.dataset.category)

  if (!value) {
    overrides.delete(key)
  } else {
    overrides.set(key, value)
  }

  injectThemeIntoIframe(frame, value)
}

function selectItem(name, category) {
  setGroupCollapsed(category, false)
  var el = document.querySelector('.item[data-name="' + cssEscape(name) + '"][data-category="' + cssEscape(category) + '"]')
  if (!el) return
  document.querySelectorAll('.item.active').forEach(function(n) { n.classList.remove('active') })
  el.classList.add('active')

  var item = ITEMS.find(function(it) { return it.name === name && it.category === category })
  setMode('detail')
  currentItem = item || null
  if (item) {
    if (editComponentBtn) editComponentBtn.disabled = false
    if (refReadable) refReadable.textContent = item.readableRef
    loadComponentDoc(item)
  }

  var depTag = document.getElementById('depTag')
  if (depTag && item && item.deps) {
    var hasDep = item.deps.palette || item.deps.variant
    var depLabel = hasDep
      ? (item.deps.palette || '?') + '/' + (item.deps.variant || '?')
      : '未指定'
    depTag.textContent = depLabel
    depTag.className = 'tag ' + (hasDep ? 'detected' : 'none')
  }

  // restore select from override or default
  var sel = document.getElementById('selTheme')
  var current = getCurrentOverride(name, category)
  if (sel) sel.value = current || ''

  if (themeBar) themeBar.classList.remove('hidden')

  var newFrame = document.getElementById('frame')
  if (newFrame && item) {
    newFrame.src = item.url
    newFrame.onload = function() {
      var ov = getCurrentOverride(name, category)
      if (ov) injectThemeIntoIframe(newFrame, ov)
    }
  }

  history.replaceState(null, '', '#/c/' + encodeURIComponent(category) + '/' + encodeURIComponent(name))
}

function showAll() {
  document.querySelectorAll('.item.active').forEach(function(n) { n.classList.remove('active') })
  if (themeBar) themeBar.classList.add('hidden')
  collapseAllGroups()
  setKnowledgePlaceholder('查看全部时请先切回单个组件')
  setMode('grid')
  history.replaceState(null, '', '#/all')
}

function setMode(mode) {
  currentMode = mode
  if (mode === 'detail') {
    detail.className = 'detail'
    frameWrap.innerHTML = ITEMS.length === 0
      ? '<div class="empty">在 components/ 下按目录分组放组件 html 即会出现</div>'
      : '<iframe id="frame" src="" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>'
    if (toggleAll) toggleAll.classList.remove('on')
  } else {
    detail.className = 'grid'
    frameWrap.innerHTML = '<div class="cards">' + ITEMS.map(function(it) {
      return '<div class="card" data-c="' + cssEscape(it.category) + '" data-n="' + cssEscape(it.name) + '">' +
        '<div class="card-header">' +
          '<div class="meta">' + escapeHtml(it.category) + '</div>' +
          '<div class="name">' + escapeHtml(it.name) + '</div>' +
        '</div>' +
        '<iframe src="' + it.url + '" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>' +
      '</div>'
    }).join('') + '</div>'
    if (toggleAll) toggleAll.classList.add('on')
    document.querySelectorAll('.card').forEach(function(card) {
      card.addEventListener('click', function() { selectItem(card.dataset.n, card.dataset.c) })
    })
  }
}

function toggleComponentsOverview() {
  if (currentMode === 'grid') {
    if (ITEMS[0]) selectItem(ITEMS[0].name, ITEMS[0].category)
  } else {
    showAll()
  }
}

function cssEscape(s) { return String(s).replace(/"/g, '\\\\"') }
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

document.querySelectorAll('.item').forEach(function(el) {
  el.addEventListener('click', function() { selectItem(el.dataset.name, el.dataset.category) })
})

document.querySelectorAll('[data-item-action]').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    e.preventDefault()
    e.stopPropagation()
    var itemEl = btn.closest('.item')
    if (!itemEl) return
    var item = ITEMS.find(function(it) { return it.name === itemEl.dataset.name && it.category === itemEl.dataset.category })
    if (!item) return
    var action = btn.getAttribute('data-item-action')
    if (action === 'edit') postEditComponent(item)
    else if (action === 'delete') deleteCurrentComponent(item)
  })
})

document.querySelectorAll('.group-toggle').forEach(function(el) {
  el.addEventListener('click', function() { toggleGroup(el.dataset.category) })
})

document.getElementById('btnResetTheme')?.addEventListener('click', function() {
  var sel = document.getElementById('selTheme')
  if (sel) sel.value = ''
  applyThemeOverride()
})

if (toggleAll) {
  toggleAll.addEventListener('click', toggleComponentsOverview)
}

window.addEventListener('message', function(event) {
  if (event.data && event.data.type === '__uikit_toggle_components_overview__') {
    toggleComponentsOverview()
  }
})

document.getElementById('copyRefBtn')?.addEventListener('click', function() {
  if (!currentItem) return
  copyText(buildReferencePayload(currentItem), '引用已复制')
})

document.getElementById('copyRefDocBtn')?.addEventListener('click', function() {
  if (!currentItem || !docEditor) return
  copyText(buildReferencePayload(currentItem) + '\\n\\n' + docEditor.value.trim(), '引用和说明已复制')
})

document.getElementById('saveDocBtn')?.addEventListener('click', function() {
  void saveCurrentDoc()
})

editComponentBtn?.addEventListener('click', function() {
  openCurrentComponentEditor()
})

function applyHash() {
  var m = location.hash.match(/^#\\/c\\/([^/]+)\\/(.+)$/)
  if (m) {
    selectItem(decodeURIComponent(m[2]), decodeURIComponent(m[1]))
    return
  }
  if (location.hash === '#/all') {
    showAll()
    return
  }
  collapseAllGroups()
  document.querySelectorAll('.item.active').forEach(function(n) { n.classList.remove('active') })
  if (ITEMS.length > 0) {
    setKnowledgePlaceholder('请选择左侧目录和组件')
    showEmptyDetail('选择左侧目录展开组件')
  } else {
    setKnowledgePlaceholder('当前没有组件可维护')
  }
}

populateSelects()
applyHash()
window.addEventListener('hashchange', applyHash)

document.addEventListener('keydown', function(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  var items = Array.from(document.querySelectorAll('.item'))
  var idx = items.findIndex(function(el) { return el.classList.contains('active') })
  var next = idx + (e.key === 'ArrowDown' ? 1 : -1)
  if (next < 0) next = items.length - 1
  if (next >= items.length) next = 0
  var el = items[next]
  if (el) {
    el.scrollIntoView({ block: 'nearest' })
    selectItem(el.dataset.name, el.dataset.category)
    e.preventDefault()
  }
})
</script>
</body>
</html>`
}

function injectComponentPreviewAnchors(
  html: string,
  meta: { relPath: string; componentId: string }
): string {
  const script = `
<script>
(function() {
  const meta = ${JSON.stringify(meta)}
  function slugify(input) {
    return String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[\\s_/]+/g, '-')
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  }
  function buildId(labels) {
    const tail = labels.map(slugify).filter(Boolean).join('/')
    return tail ? meta.componentId + '#' + tail : meta.componentId
  }
  function fallbackCopy(text) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text) })
      return
    }
    fallbackCopy(text)
  }
  function makeButton(labels) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '复制 ID'
    button.style.marginLeft = '8px'
    button.style.padding = '2px 8px'
    button.style.border = '1px solid rgba(15,23,42,0.16)'
    button.style.borderRadius = '999px'
    button.style.background = 'rgba(255,255,255,0.92)'
    button.style.color = '#1f2937'
    button.style.fontSize = '10px'
    button.style.fontWeight = '500'
    button.style.lineHeight = '1.4'
    button.style.cursor = 'pointer'
    button.style.verticalAlign = 'middle'
    button.style.transition = 'background 0.15s ease'
    button.addEventListener('mouseenter', function() {
      button.style.background = 'rgba(241,245,249,1)'
    })
    button.addEventListener('mouseleave', function() {
      button.style.background = 'rgba(255,255,255,0.92)'
    })
    button.addEventListener('click', function(ev) {
      ev.preventDefault()
      ev.stopPropagation()
      copy(buildId(labels))
      const original = button.textContent
      button.textContent = '已复制'
      window.setTimeout(function() { button.textContent = original }, 1200)
    })
    return button
  }
  function bindLabel(target, labels) {
    if (!target || target.dataset.workspaceAnchorBound === '1') return
    target.dataset.workspaceAnchorBound = '1'
    target.appendChild(makeButton(labels))
  }
  function collectSectionLabel(target) {
    const text = (target.textContent || '').replace(/\\s+/g, ' ').trim()
    return text ? [text] : []
  }
  // 变体标签：每个 [MARKUP-VARIANT] 对应一个 .preview-variant-label
  Array.from(document.querySelectorAll('.preview-variant-label')).forEach(function(node) {
    const variant = (node.textContent || '').replace(/\\s+/g, ' ').trim()
    if (!variant) return
    bindLabel(node, [variant])
  })
  // demo 项 / 状态项的小标签
  Array.from(document.querySelectorAll('.preview-item__label, .preview-state__label')).forEach(function(node) {
    const label = (node.textContent || '').replace(/\\s+/g, ' ').trim()
    if (!label) return
    bindLabel(node, [label])
  })
  // section 标题（无具体变体时）
  Array.from(document.querySelectorAll('.preview-section__title')).forEach(function(node) {
    bindLabel(node, collectSectionLabel(node))
  })
  // 兜底：data-variant / data-demo 显式标记
  Array.from(document.querySelectorAll('[data-variant]')).forEach(function(node) {
    const parentDemo = node.closest('[data-demo]')
    const labels = [parentDemo && parentDemo.getAttribute('data-demo'), node.getAttribute('data-variant')].filter(Boolean)
    bindLabel(node, labels)
  })
})();
</script>`
  const idx = html.toLowerCase().lastIndexOf('</body>')
  if (idx === -1) return html + script
  return html.slice(0, idx) + script + html.slice(idx)
}

function renderIconsHtml(opts: {
  projectName: string
  projectId: string
  writeToken: string
  themeCssUrl: string
  readonly?: boolean
  icons: Array<{ name: string; url: string; category: string; semantic?: string }>
}): string {
  // 按 category 分组
  const groups: Record<string, Array<{ name: string; url: string; semantic?: string }>> = {}
  for (const i of opts.icons) {
    const cat = i.category || '根目录'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push({ name: i.name, url: i.url, semantic: i.semantic })
  }
  const sortedCats = Object.keys(groups).sort()
  const readonlyJson = JSON.stringify(!!opts.readonly)

  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>图标预览 · ${opts.projectName}</title>
<link rel="stylesheet" href="${opts.themeCssUrl}" />
<style>
  :root {
    color-scheme: light;
    --icon-bg: #fffdf3;
    --icon-surface: #fffaf0;
    --icon-surface-muted: #fbf6e8;
    --icon-accent-soft: #eef7e7;
    --icon-border: rgba(92, 82, 54, 0.18);
    --icon-border-strong: rgba(92, 82, 54, 0.28);
    --icon-text: #172414;
    --icon-muted: #63705b;
    --icon-subtle: #87907f;
    --icon-accent: #66a962;
    --icon-danger: #d84a3a;
    --icon-warning: #c68b1b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--icon-bg); color: var(--icon-text); }
  header { padding: 8px 24px 14px; border-bottom: 1px solid var(--icon-border); background: var(--icon-bg); }
  h1 { font-size: 15px; line-height: 1.35; font-weight: 650; margin: 0; letter-spacing: 0; color: var(--icon-text); }
  .hint { font-size: 12px; line-height: 1.5; color: var(--icon-muted); margin-top: 3px; }
  .icon-section {
    margin: 14px 24px 0;
    border: 1px solid var(--icon-border);
    border-radius: 10px;
    background: var(--icon-surface);
    overflow: hidden;
  }
  .section-toggle {
    width: 100%;
    min-height: 46px;
    padding: 0 14px;
    border: 0;
    border-bottom: 1px solid var(--icon-border);
    background: var(--icon-surface-muted);
    color: var(--icon-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .section-toggle:hover { background: var(--icon-accent-soft); color: var(--icon-text); }
  .section-toggle:focus-visible { outline: 1px solid var(--icon-accent); outline-offset: -1px; }
  .icon-section.collapsed .section-toggle { border-bottom-color: transparent; }
  .section-chevron {
    width: 14px;
    color: var(--icon-subtle);
    font-size: 12px;
    transition: transform 0.12s ease;
  }
  .icon-section:not(.collapsed) .section-chevron { transform: rotate(90deg); }
  .section-path {
    flex: 1;
    min-width: 0;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .section-count {
    min-width: 24px;
    height: 20px;
    padding: 0 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--icon-bg);
    color: var(--icon-muted);
    font-size: 11px;
    font-weight: 600;
  }
  .section-body { padding: 12px; }
  .icon-section.collapsed .section-body { display: none; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .card { border: 1px solid var(--icon-border); border-radius: 8px; padding: 12px; background: var(--icon-bg); display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .card .icon-wrap { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
  .card img { max-width: 40px; max-height: 40px; }
  .name { font-size: 10px; font-family: 'SF Mono', Menlo, monospace; color: var(--icon-muted); word-break: break-all; text-align: center; }
  input.semantic-input {
    width: 100%; padding: 4px 6px; font-size: 11px; border: 1px solid var(--icon-border-strong); border-radius: 4px;
    background: var(--icon-surface); color: var(--icon-text);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  input.semantic-input:focus { outline: 1px solid var(--icon-accent); outline-offset: 0; border-color: var(--icon-accent); }
  input.semantic-input.saving { border-color: var(--icon-warning); }
  input.semantic-input.saved { border-color: var(--icon-accent); }
  input.semantic-input.error { border-color: var(--icon-danger); }
  input.semantic-input:disabled { color: var(--icon-subtle); background: var(--icon-surface-muted); cursor: default; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${opts.projectName} · 图标预览</h1>
      <div class="hint">${opts.icons.length} 个图标 · 来自 assets/ 下的 ${sortedCats.length} 个目录</div>
    </div>
  </header>
  ${sortedCats.map((cat) => `
    <div class="icon-section collapsed" data-category="${escapeHtml(cat)}">
      <button class="section-toggle" type="button" data-category="${escapeHtml(cat)}" aria-expanded="false">
        <span class="section-chevron" aria-hidden="true">›</span>
        <span class="section-path">${escapeHtml(cat.toUpperCase())}</span>
        <span class="section-count">${groups[cat].length}</span>
      </button>
      <div class="section-body">
        <div class="cards">
          ${groups[cat].map((i) => `
            <div class="card" data-name="${escapeHtml(i.name)}">
              <div class="icon-wrap"><img src="${i.url}" alt="${escapeHtml(i.name)}" /></div>
              <div class="name">${escapeHtml(i.name)}</div>
              <input class="semantic-input"
                     type="text"
                     placeholder="语义"
                     value="${escapeHtml(i.semantic ?? '')}"
                     ${opts.readonly ? 'disabled' : ''}
                     data-original="${escapeHtml(i.semantic ?? '')}" />
            </div>
          `).join('')}
        </div>
          </div>
    </div>
  `).join('')}
  ${opts.icons.length === 0 ? '<div style="padding: 40px; text-align: center; color: #8e8e93;">assets/ 目录下没有图标（支持 svg/png/jpg/webp/gif/ico/bmp）</div>' : ''}
<script>
const PROJECT_ID = ${JSON.stringify(opts.projectId)}
const TOKEN = ${JSON.stringify(opts.writeToken)}
const READONLY = ${readonlyJson}

function findIconGroup(category) {
  return Array.from(document.querySelectorAll('.icon-section')).find(function(el) {
    return el.dataset.category === category
  }) || null
}

function setIconGroupCollapsed(category, collapsed) {
  var group = findIconGroup(category)
  if (!group) return
  group.classList.toggle('collapsed', collapsed)
  var toggle = group.querySelector('.section-toggle')
  if (toggle) toggle.setAttribute('aria-expanded', String(!collapsed))
}

function toggleIconGroup(category) {
  var group = findIconGroup(category)
  if (!group) return
  setIconGroupCollapsed(category, !group.classList.contains('collapsed'))
}

document.querySelectorAll('.section-toggle').forEach(function(el) {
  el.addEventListener('click', function() { toggleIconGroup(el.dataset.category) })
})

if (READONLY) {
  document.querySelectorAll('input.semantic-input').forEach((input) => {
    input.setAttribute('title', '外部 UI 资产区以只读方式预览')
  })
} else {

document.querySelectorAll('input.semantic-input').forEach((input) => {
  let timer = null
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => save(input), 600)
  })
  input.addEventListener('blur', () => {
    clearTimeout(timer)
    save(input)
  })
})
}

async function save(input) {
  if (READONLY) return
  const card = input.closest('.card')
  const name = card.dataset.name
  const value = input.value.trim()
  if (input.dataset.original === value) return
  input.classList.remove('saved', 'error')
  input.classList.add('saving')
  try {
    const r = await fetch('/api/icons/semantic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN },
      body: JSON.stringify({ projectId: PROJECT_ID, name, semantic: value })
    })
    if (!r.ok) throw new Error(await r.text())
    input.classList.remove('saving')
    input.classList.add('saved')
    input.dataset.original = value
    setTimeout(() => input.classList.remove('saved'), 1200)
  } catch (e) {
    input.classList.remove('saving')
    input.classList.add('error')
    console.error(e)
  }
}
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
