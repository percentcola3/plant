import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { call } from '@/lib/api'
import { createDefaultProductMeta, type ProductPreviewMeta } from '@/lib/preview/product-preview'
import type { PreviewProjectContext } from '@/lib/preview/preview-project'
import { supportsPersonalSpaces } from '@shared/workspace-policy'
import { useEditorStore } from './editor'
import { useWorkspacesStore } from './workspaces'

export type PreviewType = 'component' | 'icon' | 'product' | 'image' | 'markdown' | 'files' | 'uikit-components' | 'uikit-images'

export type ComponentPreviewMeta = {
  path: string
  htmlPath: string
}

export type MarkdownPreviewMeta = {
  relPath: string
}

export type ProductFilesMeta = {
  rootRelPath: string
  primaryRelPath?: string
  activeRelPath?: string
}

export type DevicePreset = {
  name: string
  width: number
  height: number
  type: 'mobile' | 'tablet' | 'desktop'
}

export type PreviewTab = {
  id: string
  type: PreviewType
  title: string
  url: string
  workspaceId: string
  project?: PreviewProjectContext
  loadingState: 'loading' | 'loaded' | 'error'
  productMeta?: ProductPreviewMeta
  componentMeta?: ComponentPreviewMeta
  markdownMeta?: MarkdownPreviewMeta
  filesMeta?: ProductFilesMeta
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { name: '响应式', width: 0, height: 0, type: 'desktop' },
  { name: 'iPhone SE', width: 375, height: 667, type: 'mobile' },
  { name: 'iPhone 14', width: 390, height: 844, type: 'mobile' },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932, type: 'mobile' },
  { name: 'iPad Mini', width: 768, height: 1024, type: 'tablet' },
  { name: 'iPad Pro 11"', width: 834, height: 1194, type: 'tablet' },
  { name: '1280 × 800', width: 1280, height: 800, type: 'desktop' },
  { name: '1920 × 1080', width: 1920, height: 1080, type: 'desktop' }
]

let tabSeq = 0
function nextId(): string { return `pv_${++tabSeq}` }

export const usePreviewStore = defineStore('preview', () => {
  const workspaces = useWorkspacesStore()
  const tabs = ref<PreviewTab[]>([])
  const activeTabId = ref<string | null>(null)
  const lastActiveTabIdByProject = ref<Record<string, string>>({})
  const dirtyTabIds = ref<Set<string>>(new Set())
  const productFilesReloadTokens = ref<Record<string, number>>({})
  let activationSeq = 0

  const activeTab = computed(() =>
    tabs.value.find(tab => tab.id === activeTabId.value) ?? null
  )
  const activeProjectKey = computed(() => activeTab.value?.project?.key ?? null)
  const openProjects = computed<PreviewProjectContext[]>(() => {
    const seen = new Set<string>()
    const projects: PreviewProjectContext[] = []
    for (const tab of tabs.value) {
      if (!tab.project || seen.has(tab.project.key)) continue
      seen.add(tab.project.key)
      projects.push(tab.project)
    }
    return projects
  })
  const activeProject = computed(() =>
    openProjects.value.find(project => project.key === activeProjectKey.value) ?? null
  )
  const activeProjectTabs = computed(() => tabsForProject(activeProjectKey.value))
  const visibleTabs = computed(() =>
    activeProjectKey.value
      ? activeProjectTabs.value
      : tabs.value.filter(tab => !tab.project)
  )
  // 预览画布是否展示（与 tab 是否仍打开分离，便于回首页后保留 tab）。
  const canvasVisible = ref(false)
  const isPreviewActive = computed(() => canvasVisible.value)
  const hasOpenTabs = computed(() => tabs.value.length > 0)

  function showCanvas(): void {
    canvasVisible.value = true
  }

  function hideCanvas(): void {
    canvasVisible.value = false
  }

  function syncCanvasVisibility(): void {
    if (tabs.value.length === 0) canvasVisible.value = false
  }

  const activeWorkspacePath = computed(() => {
    const tab = activeTab.value
    if (!tab) return null
    switch (tab.type) {
      case 'product': return tab.productMeta?.path ?? 'outputs/'
      case 'files': return tab.filesMeta?.rootRelPath ?? null
      case 'component': return tab.componentMeta?.path ?? 'components/'
      case 'icon':
      case 'image': return 'assets/'
      default: return null
    }
  })

  let workspaceSyncTimer: ReturnType<typeof setTimeout> | null = null
  async function syncWorkspace(tab: PreviewTab | null): Promise<void> {
    const project = tab?.project ?? null
    await call(
      'workspace.setWatchScope',
      project
        ? { workspaceId: project.workspaceId, projectRelPath: project.relPath }
        : { workspaceId: null, projectRelPath: null }
    )
  }
  function debouncedSyncWorkspace(tab: PreviewTab | null): void {
    if (workspaceSyncTimer) clearTimeout(workspaceSyncTimer)
    workspaceSyncTimer = setTimeout(() => {
      workspaceSyncTimer = null
      void syncWorkspace(tab)
    }, 300)
  }

  function tabsForProject(projectKey: string | null): PreviewTab[] {
    if (!projectKey) return tabs.value.filter(tab => !tab.project)
    return tabs.value.filter(tab => tab.project?.key === projectKey)
  }

  function rememberActiveTab(tab: PreviewTab): void {
    if (!tab.project) return
    lastActiveTabIdByProject.value = {
      ...lastActiveTabIdByProject.value,
      [tab.project.key]: tab.id
    }
  }

  function activateTabLocally(tab: PreviewTab): void {
    activeTabId.value = tab.id
    rememberActiveTab(tab)
    debouncedSyncWorkspace(tab)
  }

  function activateProjectWorkspace(project: PreviewProjectContext): Promise<boolean> {
    const workspace = workspaces.list.find(item => item.id === project.workspaceId)
    if (workspace && !supportsPersonalSpaces(workspace)) {
      return activateSimpleProjectWorkspace(project.workspaceId)
    }
    return workspaces.activateSpace(project.workspaceId, project.spaceSlug)
  }

  async function activateSimpleProjectWorkspace(workspaceId: string): Promise<boolean> {
    if (workspaces.activeId !== workspaceId) await workspaces.setActive(workspaceId)
    return workspaces.activeId === workspaceId
  }

  async function activateProject(projectKey: string): Promise<void> {
    const project = openProjects.value.find(item => item.key === projectKey)
    if (!project) return
    const seq = ++activationSeq
    const previousTab = activeTab.value
    const leavingTabs = previousTab?.project?.key && previousTab.project.key !== projectKey
      ? tabsForProject(previousTab.project.key)
      : []
    if (!confirmDiscardTabs(leavingTabs)) return
    const rememberedId = lastActiveTabIdByProject.value[projectKey]
    const target = tabs.value.find(tab => tab.id === rememberedId && tab.project?.key === projectKey)
      ?? tabsForProject(projectKey)[0]
    if (!target) return

    const activated = await activateProjectWorkspace(project)
    if (seq !== activationSeq) return
    if (!activated) {
      if (previousTab) activateTabLocally(previousTab)
      return
    }
    clearDirtyTabs(leavingTabs)
    activateTabLocally(target)
    if (workspaces.activeId !== project.workspaceId && previousTab) {
      activateTabLocally(previousTab)
      return
    }
    showCanvas()
  }

  function findExistingTab(input: Omit<PreviewTab, 'id' | 'loadingState'>): PreviewTab | undefined {
    if (input.type === 'markdown') {
      return tabs.value.find(tab => tab.type === 'markdown'
        && tab.workspaceId === input.workspaceId
        && tab.markdownMeta?.relPath === input.markdownMeta?.relPath)
    }
    if (input.type === 'files') {
      return tabs.value.find(tab => tab.type === 'files'
        && tab.workspaceId === input.workspaceId
        && tab.project?.key === input.project?.key
        && tab.filesMeta?.rootRelPath === input.filesMeta?.rootRelPath)
    }
    return tabs.value.find(tab => tab.type === input.type
      && tab.workspaceId === input.workspaceId
      && tab.project?.key === input.project?.key
      && tab.url === input.url)
  }

  function openTab(input: Omit<PreviewTab, 'id' | 'loadingState'>): void {
    const existing = findExistingTab(input)
    if (existing) {
      existing.title = input.title
      existing.project = input.project
      if (input.filesMeta) {
        existing.filesMeta = {
          ...existing.filesMeta,
          ...input.filesMeta,
          activeRelPath: input.filesMeta.activeRelPath ?? existing.filesMeta?.activeRelPath
        }
      }
      if (input.productMeta && !existing.productMeta) existing.productMeta = input.productMeta
      activateTabLocally(existing)
      if (workspaces.activeId !== input.workspaceId) void workspaces.setActive(input.workspaceId)
      showCanvas()
      return
    }

    const tab: PreviewTab = { ...input, id: nextId(), loadingState: 'loading' }
    tabs.value.push(tab)
    activateTabLocally(tab)
    if (workspaces.activeId !== input.workspaceId) void workspaces.setActive(input.workspaceId)
    showCanvas()
  }

  function openProject(input: { project: PreviewProjectContext; primaryRelPath?: string }): void {
    const existing = tabs.value.find(tab => tab.type === 'files'
      && tab.project?.key === input.project.key
      && tab.filesMeta?.rootRelPath === input.project.relPath)
    const changesPrimaryFile = !!existing
      && !!input.primaryRelPath
      && existing.filesMeta?.primaryRelPath !== input.primaryRelPath
    if (existing && changesPrimaryFile && !confirmDiscardTabs([existing])) return
    if (existing && changesPrimaryFile) clearDirtyTabs([existing])
    const preservedActive = !changesPrimaryFile ? existing?.filesMeta?.activeRelPath : input.primaryRelPath
    openTab({
      type: 'files',
      title: input.project.name,
      url: '',
      workspaceId: input.project.workspaceId,
      project: input.project,
      productMeta: existing?.productMeta ?? createDefaultProductMeta(input.project.relPath),
      filesMeta: {
        rootRelPath: input.project.relPath,
        ...(input.primaryRelPath
          ? { primaryRelPath: input.primaryRelPath }
          : existing?.filesMeta?.primaryRelPath
            ? { primaryRelPath: existing.filesMeta.primaryRelPath }
            : {}),
        ...(preservedActive ? { activeRelPath: preservedActive } : {})
      }
    })
  }

  function disposeTab(tab: PreviewTab): void {
    if (dirtyTabIds.value.has(tab.id)) {
      const next = new Set(dirtyTabIds.value)
      next.delete(tab.id)
      dirtyTabIds.value = next
    }
    if (tab.type !== 'markdown') return
    try { useEditorStore().closeKey(tab.id) } catch { /* store 未初始化场景 */ }
  }

  function closeTab(id: string): void {
    const index = tabs.value.findIndex(tab => tab.id === id)
    if (index === -1) return
    const closing = tabs.value[index]
    if (!confirmDiscardTabs([closing])) return
    disposeTab(closing)
    tabs.value.splice(index, 1)

    if (closing.project && tabsForProject(closing.project.key).length === 0) {
      const nextMap = { ...lastActiveTabIdByProject.value }
      delete nextMap[closing.project.key]
      lastActiveTabIdByProject.value = nextMap
    }
    if (activeTabId.value !== id) return

    const sameProject = closing.project ? tabsForProject(closing.project.key) : tabsForProject(null)
    const next = sameProject.at(-1) ?? tabs.value.at(-1) ?? null
    activeTabId.value = next?.id ?? null
    if (next) {
      rememberActiveTab(next)
      if (next.project) void activateProject(next.project.key)
      else if (workspaces.activeId !== next.workspaceId) void workspaces.setActive(next.workspaceId)
    }
    debouncedSyncWorkspace(next)
    syncCanvasVisibility()
  }

  function setActive(id: string): void {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab || activeTabId.value === id) return
    activateTabLocally(tab)
    if (workspaces.activeId !== tab.workspaceId) void workspaces.setActive(tab.workspaceId)
    showCanvas()
  }

  function setTabLoaded(id: string): void {
    const tab = tabs.value.find(item => item.id === id)
    if (tab) tab.loadingState = 'loaded'
  }
  function setTabError(id: string): void {
    const tab = tabs.value.find(item => item.id === id)
    if (tab) tab.loadingState = 'error'
  }
  function retryTab(id: string): void {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab) return
    tab.loadingState = 'loading'
    const sep = tab.url.includes('?') ? '&' : '?'
    tab.url = tab.url.split(/[?&#]/)[0] + sep + '_t=' + Date.now()
  }

  function relocateProjectRoot(oldRelPath: string, newRelPath: string, newName?: string): void {
    const normalizedOld = oldRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalizedNew = newRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
    for (const tab of tabs.value) {
      if (tab.filesMeta?.rootRelPath === normalizedOld) {
        tab.filesMeta.rootRelPath = normalizedNew
        if (tab.filesMeta.primaryRelPath?.startsWith(`${normalizedOld}/`)) {
          tab.filesMeta.primaryRelPath = tab.filesMeta.primaryRelPath.replace(normalizedOld, normalizedNew)
        } else if (tab.filesMeta.primaryRelPath === normalizedOld) {
          tab.filesMeta.primaryRelPath = normalizedNew
        }
      }
      if (tab.productMeta?.path === normalizedOld) {
        tab.productMeta.path = normalizedNew
      }
      if (tab.project?.relPath === normalizedOld) {
        tab.project.relPath = normalizedNew
        if (newName) tab.project.name = newName
        tab.project.key = `${tab.project.workspaceId}::${tab.project.spaceSlug}::${normalizedNew}`
      }
    }
    debouncedSyncWorkspace(activeTab.value)
  }

  function forceCloseTabsForRootRelPath(rootRelPath: string): void {
    const normalized = rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const closing = tabs.value.filter(tab =>
      tab.filesMeta?.rootRelPath === normalized || tab.productMeta?.path === normalized
    )
    if (closing.length === 0) return
    for (const tab of closing) disposeTab(tab)
    const closingIds = new Set(closing.map(tab => tab.id))
    tabs.value = tabs.value.filter(tab => !closingIds.has(tab.id))
    if (!closing.some(tab => tab.id === activeTabId.value)) return
    const next = tabs.value.at(-1) ?? null
    activeTabId.value = next?.id ?? null
    if (next) rememberActiveTab(next)
    debouncedSyncWorkspace(next)
    syncCanvasVisibility()
  }

  function reloadAllProductTabs(projectKey = activeProjectKey.value): void {
    const stamp = Date.now()
    for (const tab of tabs.value) {
      if (projectKey && tab.project?.key !== projectKey) continue
      if (tab.type !== 'product' && tab.type !== 'component') continue
      tab.url = bumpReloadStamp(tab.url, stamp)
    }
  }

  function productFilesReloadKey(workspaceId: string, rootRelPath: string): string {
    return `${workspaceId}\0${rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')}`
  }

  function productFilesReloadToken(workspaceId: string, rootRelPath: string): number {
    return productFilesReloadTokens.value[productFilesReloadKey(workspaceId, rootRelPath)] ?? 0
  }

  function notifyProductFilesChanged(input: { workspaceId: string; rootRelPath: string }): void {
    const key = productFilesReloadKey(input.workspaceId, input.rootRelPath)
    productFilesReloadTokens.value = {
      ...productFilesReloadTokens.value,
      [key]: (productFilesReloadTokens.value[key] ?? 0) + 1
    }
  }
  function bumpReloadStamp(url: string, stamp: number): string {
    if (/[?&]_t=\d+/.test(url)) return url.replace(/([?&])_t=\d+/, `$1_t=${stamp}`)
    const sep = url.includes('?') ? '&' : '?'
    const [base, hash = ''] = url.split('#')
    const stamped = base + sep + '_t=' + stamp
    return hash ? `${stamped}#${hash}` : stamped
  }

  function updateDevice(id: string, opts: Partial<NonNullable<PreviewTab['productMeta']>>): void {
    const tab = tabs.value.find(item => item.id === id)
    if (tab?.productMeta) Object.assign(tab.productMeta, opts)
  }

  function setTabDirty(id: string, dirty: boolean): void {
    const next = new Set(dirtyTabIds.value)
    if (dirty) next.add(id)
    else next.delete(id)
    dirtyTabIds.value = next
  }

  function setProductFilesActiveRelPath(id: string, relPath: string | null): void {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab?.filesMeta) return
    if (relPath) tab.filesMeta.activeRelPath = relPath
    else delete tab.filesMeta.activeRelPath
  }

  function clearDirtyTabs(targets: PreviewTab[]): void {
    if (targets.length === 0) return
    const ids = new Set(targets.map(tab => tab.id))
    dirtyTabIds.value = new Set([...dirtyTabIds.value].filter(id => !ids.has(id)))
  }

  function confirmDiscardTabs(targets: PreviewTab[]): boolean {
    if (!targets.some(tab => dirtyTabIds.value.has(tab.id))) return true
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
    return window.confirm('当前项目有未保存的文件，确定放弃改动吗？')
  }

  function clearAll(): void {
    if (!confirmDiscardTabs(tabs.value)) return
    for (const tab of tabs.value) disposeTab(tab)
    tabs.value = []
    activeTabId.value = null
    lastActiveTabIdByProject.value = {}
    canvasVisible.value = false
    debouncedSyncWorkspace(null)
  }

  function deactivate(): void {
    hideCanvas()
  }

  async function closeProject(projectKey: string): Promise<void> {
    const closingTabs = tabsForProject(projectKey)
    if (closingTabs.length === 0) return
    if (!confirmDiscardTabs(closingTabs)) return
    for (const tab of closingTabs) disposeTab(tab)
    const wasActive = activeProjectKey.value === projectKey
    tabs.value = tabs.value.filter(tab => tab.project?.key !== projectKey)
    const nextMap = { ...lastActiveTabIdByProject.value }
    delete nextMap[projectKey]
    lastActiveTabIdByProject.value = nextMap
    if (!wasActive) return

    const nextProject = openProjects.value.at(-1)
    if (nextProject) {
      await activateProject(nextProject.key)
      return
    }
    const nextTab = tabs.value.at(-1) ?? null
    activeTabId.value = nextTab?.id ?? null
    debouncedSyncWorkspace(nextTab)
    syncCanvasVisibility()
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    activeProjectKey,
    activeProject,
    activeProjectTabs,
    visibleTabs,
    openProjects,
    hasOpenTabs,
    isPreviewActive,
    showCanvas,
    hideCanvas,
    activeWorkspacePath,
    tabsForProject,
    activateProject,
    closeProject,
    openProject,
    openTab,
    closeTab,
    setActive,
    setTabLoaded,
    setTabError,
    retryTab,
    reloadAllProductTabs,
    productFilesReloadToken,
    notifyProductFilesChanged,
    setProductFilesActiveRelPath,
    relocateProjectRoot,
    forceCloseTabsForRootRelPath,
    updateDevice,
    setTabDirty,
    deactivate,
    clearAll,
    DEVICE_PRESETS
  }
})
