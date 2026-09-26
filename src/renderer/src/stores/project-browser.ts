import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { call } from '@/lib/api'
import { usePreviewStore } from './preview'
import { browserScopeKey, type BrowserScope, type ProjectWebPage, type WebPageText } from '@shared/project-browser'

export const useProjectBrowserStore = defineStore('project-browser', () => {
  const preview = usePreviewStore()
  const pages = ref<ProjectWebPage[]>([])
  const addressDrafts = ref<Record<string, string>>({})
  const activeByScope = ref<Record<string, string | null>>({})
  let initialized: Promise<void> | undefined
  const currentScope = computed<BrowserScope | null>(() => {
    const project = preview.isPreviewActive ? preview.activeProject : null
    return project ? { workspaceId: project.workspaceId, projectRelPath: project.relPath } : null
  })
  function scopedPages(scope: BrowserScope): ProjectWebPage[] {
    return pages.value.filter(page => browserScopeKey(page) === browserScopeKey(scope))
  }
  function activePage(scope: BrowserScope): ProjectWebPage | null {
    return scopedPages(scope).find(page => page.id === activeByScope.value[browserScopeKey(scope)]) ?? null
  }
  const currentPages = computed(() => currentScope.value ? scopedPages(currentScope.value).filter(page => !!page.url) : [])
  const currentPage = computed(() => {
    const page = currentScope.value && preview.activeTab?.type === 'files' ? activePage(currentScope.value) : null
    return page?.url ? page : null
  })
  function initialize(): Promise<void> {
    if (!initialized) initialized = (async () => {
      const off = window.events.on('project-browser.changed', value => { pages.value = value as ProjectWebPage[] })
      const offActivate = window.events.on('project-browser.activate', value => {
        const page = value as ProjectWebPage
        activate(page, page.id)
      })
      const result = await call('projectBrowser.list', undefined)
      if (result.ok) pages.value = result.data
      if (import.meta.hot) import.meta.hot.dispose(() => { off(); offActivate() })
    })()
    return initialized
  }
  function activate(scope: BrowserScope, id: string | null): void {
    activeByScope.value[browserScopeKey(scope)] = id
  }
  async function open(scope: BrowserScope, url: string): Promise<void> {
    await initialize()
    const result = await call('projectBrowser.open', { ...scope, url })
    if (!result.ok) throw new Error(result.message)
    if (!pages.value.some(p => p.id === result.data.id)) pages.value.push(result.data)
    activate(scope, result.data.id)
  }
  async function close(scope: BrowserScope, id: string): Promise<void> {
    const result = await call('projectBrowser.close', { ...scope, id })
    if (!result.ok) throw new Error(result.message)
    delete addressDrafts.value[id]
    pages.value = pages.value.filter(page => page.id !== id)
    if (activeByScope.value[browserScopeKey(scope)] === id) activate(scope, scopedPages(scope).at(-1)?.id ?? null)
  }
  async function read(scope: BrowserScope, ids: string[]): Promise<WebPageText[]> {
    const selected = [...new Set(ids)]
    if (selected.length > 5) throw new Error('一次最多引用 5 个网页')
    const texts: WebPageText[] = []
    const perPageLimit = Math.min(60000, Math.floor(120000 / Math.max(1, selected.length)))
    for (const id of selected) {
      if (!scopedPages(scope).some(p => p.id === id)) throw new Error('引用的网页已关闭或不属于当前项目，请删除引用后重新选择')
      const result = await call('projectBrowser.read', { ...scope, id })
      if (!result.ok) throw new Error(result.message)
      const text = result.data.text.slice(0, perPageLimit)
      texts.push({ ...result.data, text, truncated: result.data.truncated || text.length < result.data.text.length })
    }
    return texts
  }
  watch(() => preview.openProjects.map(project => ({ workspaceId: project.workspaceId, projectRelPath: project.relPath })), (now, before) => {
    const kept = new Set(now.map(browserScopeKey))
    for (const scope of before ?? []) if (!kept.has(browserScopeKey(scope))) {
      for (const page of scopedPages(scope)) void close(scope, page.id).catch(() => {})
    }
  })
  return { pages, addressDrafts, currentScope, currentPages, currentPage, scopedPages, activePage, initialize, activate, open, close, read }
})
