import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { call } from '@/lib/api'
import type { ProjectWebPage } from '@shared/project-browser'

const state = vi.hoisted(() => ({ preview: null as any }))
vi.mock('./preview', () => ({ usePreviewStore: () => state.preview }))
vi.mock('@/lib/api', () => ({ call: vi.fn() }))
import { useProjectBrowserStore } from './project-browser'
const scope = { workspaceId: 'ws', projectRelPath: 'features/a' }
function page(id: string, projectRelPath = scope.projectRelPath): ProjectWebPage {
  return { ...scope, projectRelPath, id, title: id, url: `https://example.com/${id}`, loading: false, canGoBack: false, canGoForward: false }
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  state.preview = reactive({ isPreviewActive: true, activeTab: { type: 'files' }, activeProject: { workspaceId: 'ws', relPath: 'features/a' }, openProjects: [{ workspaceId: 'ws', relPath: 'features/a' }] })
  vi.stubGlobal('window', { events: { on: vi.fn(() => () => {}) } })
})
describe('project browser conversation state', () => {
  it('excludes empty tabs from automatic context and the webpage mention list', () => {
    const store = useProjectBrowserStore()
    store.pages = [{ ...page('blank'), url: '', title: '新标签页' }]
    store.activate(scope, 'blank')
    expect(store.activePage(scope)?.id).toBe('blank')
    expect(store.currentPage).toBeNull()
    expect(store.currentPages).toEqual([])
  })
  it('only exposes active webpages in the active project and stops automatic context when returning to files', () => {
    const store = useProjectBrowserStore()
    store.pages = [page('one'), page('other', 'features/b')]
    store.activate(scope, 'one')
    expect(store.currentPage?.id).toBe('one')
    expect(store.currentPages.map(p => p.id)).toEqual(['one'])
    store.activate(scope, null)
    expect(store.currentPage).toBeNull()
    store.activate(scope, 'one')
    state.preview.activeTab.type = 'markdown'
    expect(store.currentPage).toBeNull()
    state.preview.isPreviewActive = false
    expect(store.currentPages).toEqual([])
  })
  it('keeps per-tab address drafts during switching and clears only the closed draft', async () => {
    const store = useProjectBrowserStore()
    store.pages = [page('one'), page('two')]
    store.addressDrafts.one = 'docs.example.com'
    store.addressDrafts.two = 'example.com/draft'
    store.activate(scope, 'one')
    store.activate(scope, 'two')
    expect(store.addressDrafts.one).toBe('docs.example.com')
    vi.mocked(call).mockResolvedValue({ ok: true, data: undefined })
    await store.close(scope, 'one')
    expect(store.addressDrafts.one).toBeUndefined()
    expect(store.addressDrafts.two).toBe('example.com/draft')
  })
  it('retains webpage state when switching between projects', () => {
    const store = useProjectBrowserStore()
    store.pages = [page('one'), page('two', 'features/b')]
    store.activate(scope, 'one')
    store.activate({ ...scope, projectRelPath: 'features/b' }, 'two')
    state.preview.activeProject.relPath = 'features/b'
    expect(store.currentPage?.id).toBe('two')
    state.preview.activeProject.relPath = 'features/a'
    expect(store.currentPage?.id).toBe('one')
  })
  it('reads explicitly selected pages rather than substituting the active page', async () => {
    const store = useProjectBrowserStore()
    store.pages = [page('one'), page('two')]
    store.activate(scope, 'one')
    vi.mocked(call).mockResolvedValue({ ok: true, data: { id: 'two', text: 'selected text', title: 'two', url: 'https://example.com/two', truncated: false, capturedAt: 'now' } } as any)
    const result = await store.read(scope, ['two', 'two'])
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('projectBrowser.read', { ...scope, id: 'two' })
    expect(result[0].text).toBe('selected text')
  })
  it('rejects stale and cross-project references instead of silently dropping them', async () => {
    const store = useProjectBrowserStore()
    store.pages = [page('other', 'features/b')]
    await expect(store.read(scope, ['closed'])).rejects.toThrow('网页已关闭')
    await expect(store.read(scope, ['other'])).rejects.toThrow('不属于当前项目')
    expect(call).not.toHaveBeenCalled()
  })
  it('closes project pages when their project is closed', async () => {
    const store = useProjectBrowserStore()
    store.pages = [page('one')]
    vi.mocked(call).mockResolvedValue({ ok: true, data: undefined })
    state.preview.openProjects = []
    await nextTick()
    await nextTick()
    expect(call).toHaveBeenCalledWith('projectBrowser.close', { ...scope, id: 'one' })
    expect(store.pages).toEqual([])
  })
})
