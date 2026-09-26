// Inspector picks 桥接 store：管理 iframe 内选中的元素 picks
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type Pick = {
  alias: string
  path: string
  tabId: string
  createdAt: number
  tagName?: string
  textPreview?: string
  edits?: Record<string, string>
}

export const useInspectorPicksStore = defineStore('inspector-picks', () => {
  // tabId → picks 列表
  const picksByTab = ref<Map<string, Pick[]>>(new Map())
  // 当前激活的预览 tabId
  const activeTabId = ref<string | null>(null)

  const currentPicks = computed<Pick[]>(() => {
    if (!activeTabId.value) return []
    return picksByTab.value.get(activeTabId.value) ?? []
  })

  // inspector postMessage 触发的全量同步
  function sync(tabId: string, picks: Array<{
    alias: string
    path: string
    tagName?: string
    textPreview?: string
    edits?: Record<string, string>
  }>): void {
    const mapped: Pick[] = picks.map(p => ({
      alias: p.alias,
      path: p.path,
      tagName: p.tagName,
      textPreview: p.textPreview,
      edits: p.edits,
      tabId,
      createdAt: Date.now()
    }))
    picksByTab.value.set(tabId, mapped)
    picksByTab.value = new Map(picksByTab.value)
  }

  // 按路径查找 pick（alive 态判断）
  function findByPath(tabId: string, path: string): Pick | null {
    const picks = picksByTab.value.get(tabId)
    if (!picks) return null
    return picks.find(p => p.path === path) ?? null
  }

  function clearTab(tabId: string): void {
    picksByTab.value.delete(tabId)
    picksByTab.value = new Map(picksByTab.value)
  }

  function setActiveTab(tabId: string | null): void {
    activeTabId.value = tabId
  }

  return { picksByTab, activeTabId, currentPicks, sync, findByPath, clearTab, setActiveTab }
})
