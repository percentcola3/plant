import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeContents extends EventEmitter {
    url = ''; destroyed = false; loading = false
    executeJavaScriptInIsolatedWorld = vi.fn(async () => ({ text: '已登录的正文', truncated: false }))
    handler: any
    loadURL = vi.fn(async (url: string) => { this.url = url })
    getURL() { return this.url }
    getTitle() { return '页面标题' }
    isDestroyed() { return this.destroyed }
    isLoading() { return this.loading }
    isLoadingMainFrame() { return this.loading }
    canGoBack() { return false }
    canGoForward() { return false }
    reload() {}
    close() { this.destroyed = true; this.emit('destroyed') }
    setWindowOpenHandler(handler: any) { this.handler = handler }
  }
  return {
    BrowserWindow: class {},
    WebContentsView: class {
      webContents = new FakeContents()
      visible = false
      bounds: any
      constructor(public options: any) {}
      setVisible(value: boolean) { this.visible = value }
      setBounds(value: any) { this.bounds = value }
    },
    session: { fromPartition: vi.fn(() => ({ setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() })) }
  }
})

import { capturePageDesign, closePage, controlPage, layoutPage, listPages, openPage, readPage } from './service'
const scope = { workspaceId: 'workspace', projectRelPath: 'features/current' }
const windows: any[] = []
let seq = 0
function windowForTest(): any {
  const children: any[] = []
  const owner = Object.assign(new EventEmitter(), {
    id: ++seq,
    contentView: {
      addChildView: (view: any) => children.push(view),
      removeChildView: (view: any) => children.splice(children.indexOf(view), 1)
    },
    webContents: { send: vi.fn() }, isDestroyed: () => false, getContentSize: () => [800, 600], children
  })
  windows.push(owner)
  return owner
}
afterEach(() => { for (const owner of windows.splice(0)) owner.emit('closed') })

describe('project browser boundary and lifecycle', () => {
  it('creates an empty tab without requesting a remote URL', () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, '')
    expect(page).toMatchObject({ title: '新标签页', url: '', loading: false })
    expect(owner.children[0].webContents.loadURL).toHaveBeenCalledWith('about:blank')
    expect(owner.children[0].visible).toBe(false)
  })
  it('creates distinct blank tabs and keeps address navigation separate', () => {
    const owner = windowForTest()
    const first = openPage(owner, scope, '')
    const second = openPage(owner, scope, 'about:blank')
    expect(first.id).not.toBe(second.id)
    expect(listPages(owner).map(page => page.url)).toEqual(['', ''])
    expect(owner.children).toHaveLength(2)
  })
  it('reports rejected navigation even if Chromium sends no did-fail-load event', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, '')
    owner.children[0].webContents.loadURL.mockRejectedValueOnce(new Error('ERR_CONNECTION_REFUSED'))
    controlPage(owner, scope, page.id, 'navigate', 'https://example.com')
    await Promise.resolve()
    expect(listPages(owner)[0].error).toContain('ERR_CONNECTION_REFUSED')
    expect(listPages(owner)[0].loading).toBe(false)
  })
  it('isolates remote content and reads the loaded page with source metadata', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    expect(owner.children[0].options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })
    expect(owner.children[0].options.webPreferences.preload).toBeUndefined()
    expect(await readPage(owner, scope, page.id)).toMatchObject({ text: '已登录的正文', url: 'https://example.com/', title: '页面标题' })
    expect(owner.children[0].webContents.executeJavaScriptInIsolatedWorld.mock.calls[0][0]).toBe(1001)
  })
  it('rejects reads from another project or window', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    await expect(readPage(owner, { ...scope, projectRelPath: 'features/other' }, page.id)).rejects.toThrow('不属于当前项目')
    await expect(readPage(windowForTest(), scope, page.id)).rejects.toThrow('不属于当前项目')
  })
  it('rejects snapshots if navigation happens during extraction', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[0].webContents
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async () => {
      wc.emit('did-start-navigation', {}, 'https://other.com', false, true)
      return { text: 'old page text', truncated: false }
    })
    await expect(readPage(owner, scope, page.id)).rejects.toThrow('网页发生跳转')
  })
  it('does not read loading or textless pages', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[0].webContents
    wc.loading = true
    await expect(readPage(owner, scope, page.id)).rejects.toThrow('尚未加载完成')
    wc.loading = false
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue({ text: '', truncated: false })
    await expect(readPage(owner, scope, page.id)).rejects.toThrow('没有可读取的文本')
  })
  it('shows only one native page and clamps its bounds to the host window', () => {
    const owner = windowForTest()
    const first = openPage(owner, scope, 'https://example.com')
    const second = openPage(owner, scope, 'https://example.org')
    layoutPage(owner, scope, first.id, { x: 10, y: 20, width: 1000, height: 1000 })
    expect(owner.children[0].bounds).toEqual({ x: 10, y: 20, width: 790, height: 580 })
    layoutPage(owner, scope, second.id, { x: 10, y: 20, width: 400, height: 300 })
    expect(owner.children[0].visible).toBe(false)
    expect(owner.children[1].visible).toBe(true)
    layoutPage(owner, scope, second.id, null)
    expect(owner.children[1].visible).toBe(false)
  })
  it('destroys closed pages and rejects stale references', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[0].webContents
    closePage(owner, scope, page.id)
    expect(wc.destroyed).toBe(true)
    expect(listPages(owner)).toEqual([])
    await expect(readPage(owner, scope, page.id)).rejects.toThrow('网页已关闭')
  })
})

describe('project webpage design capture', () => {
  const design = { html: '<!doctype html><html><body><h1>设计</h1></body></html>', warnings: [], viewport: { width: 1200, height: 800 } }
  it('captures a design in the isolated world with source metadata', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[0].webContents
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(design)
    expect(await capturePageDesign(owner, scope, page.id)).toMatchObject({ ...design, title: '页面标题', url: 'https://example.com/' })
    expect(wc.executeJavaScriptInIsolatedWorld.mock.calls[0][0]).toBe(1001)
    await expect(capturePageDesign(windowForTest(), scope, page.id)).rejects.toThrow('不属于当前项目')
    await expect(capturePageDesign(owner, { ...scope, projectRelPath: 'ui/other' }, page.id)).rejects.toThrow('不属于当前项目')
  })
  it('rejects stale designs when a page navigates or closes during capture', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[0].webContents
    wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(async () => {
      wc.emit('did-start-navigation', {}, 'https://example.com/next', false, true)
      return design
    })
    await expect(capturePageDesign(owner, scope, page.id)).rejects.toThrow('跳转或已关闭')
    wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(async () => {
      closePage(owner, scope, page.id)
      return design
    })
    await expect(capturePageDesign(owner, scope, page.id)).rejects.toThrow('跳转或已关闭')
  })
  it('prevents concurrent captures and permits a retry after failure', async () => {
    const owner = windowForTest()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[0].webContents
    let rejectCapture!: (error: Error) => void
    wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCapture = reject }))
    const first = capturePageDesign(owner, scope, page.id)
    await expect(capturePageDesign(owner, scope, page.id)).rejects.toThrow('正在生成')
    rejectCapture(new Error('捕获失败'))
    await expect(first).rejects.toThrow('捕获失败')
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(design)
    await expect(capturePageDesign(owner, scope, page.id)).resolves.toMatchObject(design)
  })
  it('rejects blank, loading, failed and invalid captures', async () => {
    const owner = windowForTest()
    const blank = openPage(owner, scope, '')
    await expect(capturePageDesign(owner, scope, blank.id)).rejects.toThrow()
    const page = openPage(owner, scope, 'https://example.com')
    const wc = owner.children[1].webContents
    wc.loading = true
    await expect(capturePageDesign(owner, scope, page.id)).rejects.toThrow('尚未加载完成')
    wc.loading = false
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue({ ...design, html: '' })
    await expect(capturePageDesign(owner, scope, page.id)).rejects.toThrow('无法生成设计稿')
    wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', page.url, true)
    await expect(capturePageDesign(owner, scope, page.id)).rejects.toThrow('尚未加载完成')
  })
})
