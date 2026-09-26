import { BrowserWindow, WebContentsView, session } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { browserScopeKey, normalizeBrowserUrl, type BrowserBounds, type BrowserScope, type ProjectWebPage, type WebPageText, type WebPageDesignSnapshot } from '../../shared/project-browser'
import { PAGE_TEXT_SCRIPT } from './extract'
import { PAGE_DESIGN_SCRIPT } from './design-capture'

type Page = { owner: BrowserWindow; view: WebContentsView; info: ProjectWebPage; revision: number; loadRequest: number }
const pages = new Map<string, Page>()
const owners = new Set<number>()
const capturingDesigns = new Set<string>()

function broadcast(owner: BrowserWindow): void {
  if (!owner.isDestroyed()) owner.webContents.send('project-browser.changed', listPages(owner))
}

export function listPages(owner: BrowserWindow): ProjectWebPage[] {
  return [...pages.values()].filter(page => page.owner === owner).map(page => ({ ...page.info }))
}

function pageFor(owner: BrowserWindow, scope: BrowserScope, id: string): Page {
  const page = pages.get(id)
  if (!page || page.owner !== owner || browserScopeKey(page.info) !== browserScopeKey(scope)) {
    throw new Error('网页已关闭或不属于当前项目，请重新选择网页')
  }
  return page
}

export function openPage(owner: BrowserWindow, scope: BrowserScope, inputUrl: string): ProjectWebPage {
  const url = !inputUrl.trim() || inputUrl.trim() === 'about:blank' ? '' : normalizeBrowserUrl(inputUrl)
  if ([...pages.values()].filter(p => p.owner === owner).length >= 20) throw new Error('最多同时打开 20 个网页，请先关闭不需要的网页')
  // Login persists on this machine, isolated by project. Remote content never
  // receives the host preload, IPC bridge, Node integration, or app session.
  const partition = 'persist:project-web-' + createHash('sha256').update(browserScopeKey(scope)).digest('hex')
  const browserSession = session.fromPartition(partition)
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
  const view = new WebContentsView({ webPreferences: {
    session: browserSession, sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false
  } })
  const info: ProjectWebPage = { ...scope, id: randomUUID(), url, title: url ? new URL(url).hostname : '新标签页', loading: !!url, canGoBack: false, canGoForward: false }
  const page: Page = { owner, view, info, revision: 0, loadRequest: 0 }
  pages.set(info.id, page)
  owner.contentView.addChildView(view)
  view.setVisible(false)
  const wc = view.webContents
  const update = () => {
    if (wc.isDestroyed()) return
    const currentUrl = wc.getURL()
    info.url = currentUrl === 'about:blank' ? '' : currentUrl || info.url
    info.title = info.url ? wc.getTitle() || new URL(info.url).hostname : '新标签页'
    info.loading = wc.isLoading()
    info.canGoBack = wc.canGoBack()
    info.canGoForward = wc.canGoForward()
    broadcast(owner)
  }
  wc.on('will-navigate', (event, target) => {
    try { normalizeBrowserUrl(target) } catch { event.preventDefault() }
  })
  wc.on('will-redirect', (event, target) => {
    try { normalizeBrowserUrl(target) } catch { event.preventDefault() }
  })
  wc.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) { page.revision++; info.error = undefined }
  })
  wc.on('did-start-loading', update)
  wc.on('did-stop-loading', update)
  wc.on('did-navigate', update)
  wc.on('did-navigate-in-page', update)
  wc.on('page-title-updated', update)
  wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) { info.error = `网页加载失败：${description}`; update() }
  })
  wc.on('render-process-gone', () => { info.error = '网页进程已退出，请刷新'; info.loading = false; broadcast(owner) })
  // User-opened links remain inside the project. OAuth popup flows can use a
  // sandboxed child window with the same session, preserving window.opener.
  wc.setWindowOpenHandler(({ url: target, features }) => {
    try { normalizeBrowserUrl(target) } catch { return { action: 'deny' } }
    if (!/(?:^|,)(?:width|height)=/i.test(features)) {
      try {
        const opened = openPage(owner, scope, target)
        owner.webContents.send('project-browser.activate', opened)
      } catch { /* The tab limit leaves the existing page intact. */ }
      return { action: 'deny' }
    }
    return { action: 'allow', overrideBrowserWindowOptions: {
      parent: owner, width: 1000, height: 750,
      webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined }
    } }
  })
  wc.on('did-create-window', child => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', (event, target) => {
      try { normalizeBrowserUrl(target) } catch { event.preventDefault() }
    })
    wc.once('destroyed', () => { if (!child.isDestroyed()) child.close() })
  })
  if (!owners.has(owner.id)) {
    owners.add(owner.id)
    owner.once('closed', () => {
      for (const [id, owned] of pages) if (owned.owner === owner) {
        if (!owned.view.webContents.isDestroyed()) owned.view.webContents.close()
        pages.delete(id)
      }
      owners.delete(owner.id)
    })
  }
  loadPageUrl(page, url || 'about:blank')
  broadcast(owner)
  return { ...info }
}

function loadPageUrl(page: Page, url: string): void {
  const request = ++page.loadRequest
  page.info.error = undefined
  void page.view.webContents.loadURL(url).catch(error => {
    if (request !== page.loadRequest || !pages.has(page.info.id) || page.view.webContents.isDestroyed()) return
    if (error?.code === 'ERR_ABORTED' || error?.errno === -3) return
    page.info.loading = false
    page.info.error = `网页加载失败：${error instanceof Error ? error.message : String(error)}`
    broadcast(page.owner)
  })
}

export function closePage(owner: BrowserWindow, scope: BrowserScope, id: string): void {
  const page = pageFor(owner, scope, id)
  owner.contentView.removeChildView(page.view)
  page.view.webContents.close()
  pages.delete(id)
  broadcast(owner)
}

export function controlPage(owner: BrowserWindow, scope: BrowserScope, id: string, action: 'navigate' | 'back' | 'forward' | 'reload', url?: string): void {
  const page = pageFor(owner, scope, id)
  const wc = page.view.webContents
  if (action === 'navigate') loadPageUrl(page, normalizeBrowserUrl(url ?? ''))
  else if (action === 'back' && wc.canGoBack()) wc.goBack()
  else if (action === 'forward' && wc.canGoForward()) wc.goForward()
  else if (action === 'reload') wc.reload()
}

export function layoutPage(owner: BrowserWindow, scope: BrowserScope, id: string, bounds: BrowserBounds | null): void {
  const page = pageFor(owner, scope, id)
  if (!bounds) { page.view.setVisible(false); return }
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) throw new Error('网页区域无效')
  const [width, height] = owner.getContentSize()
  const x = Math.max(0, Math.min(width, Math.round(bounds.x)))
  const y = Math.max(0, Math.min(height, Math.round(bounds.y)))
  const rect = { x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) }
  for (const other of pages.values()) if (other.owner === owner && other !== page) other.view.setVisible(false)
  page.view.setBounds(rect)
  page.view.setVisible(rect.width > 0 && rect.height > 0)
}

export async function readPage(owner: BrowserWindow, scope: BrowserScope, id: string): Promise<WebPageText> {
  const page = pageFor(owner, scope, id)
  const wc = page.view.webContents
  if (wc.isLoadingMainFrame() || page.info.error) throw new Error(`${page.info.title} 尚未加载完成，请稍后重试`)
  const revision = page.revision
  const url = normalizeBrowserUrl(wc.getURL())
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(1001, [{ code: PAGE_TEXT_SCRIPT }]) as Promise<{ text: string; truncated: boolean }>,
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('读取网页超时，请刷新后重试')), 8000) })
    ])
    if (wc.isDestroyed() || page.revision !== revision || wc.getURL() !== url) throw new Error('读取时网页发生跳转，请重新发送')
    if (!result?.text?.trim()) throw new Error('当前网页没有可读取的文本，请确认已登录且正文已加载')
    return { id, url, title: wc.getTitle(), text: result.text, truncated: result.truncated, capturedAt: new Date().toISOString() }
  } finally { clearTimeout(timeout) }
}

export async function capturePageDesign(owner: BrowserWindow, scope: BrowserScope, id: string): Promise<WebPageDesignSnapshot> {
  const page = pageFor(owner, scope, id)
  const wc = page.view.webContents
  if (wc.isLoadingMainFrame() || page.info.error) throw new Error('网页尚未加载完成，请稍后再转为设计稿')
  if (capturingDesigns.has(id)) throw new Error('正在生成此网页的设计稿，请稍候')
  const revision = page.revision
  const url = normalizeBrowserUrl(wc.getURL())
  capturingDesigns.add(id)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(1001, [{ code: PAGE_DESIGN_SCRIPT }]) as Promise<Pick<WebPageDesignSnapshot, 'html' | 'warnings' | 'viewport'>>,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('生成设计稿超时，请等待页面稳定后重试')), 15000)
      })
    ])
    if (wc.isDestroyed() || !pages.has(id) || page.revision !== revision || wc.getURL() !== url) {
      throw new Error('生成时网页发生跳转或已关闭，请重新生成设计稿')
    }
    if (!result || typeof result.html !== 'string' || !result.html.trim()
      || Buffer.byteLength(result.html, 'utf8') > 20 * 1024 * 1024
      || !Array.isArray(result.warnings) || result.warnings.some(w => typeof w !== 'string')
      || !result.viewport || ![result.viewport.width, result.viewport.height].every(n => Number.isFinite(n) && n > 0)) {
      throw new Error('网页内容过大或无法生成设计稿')
    }
    return { ...result, title: wc.getTitle(), url, capturedAt: new Date().toISOString() }
  } finally {
    clearTimeout(timeout)
    capturingDesigns.delete(id)
  }
}
