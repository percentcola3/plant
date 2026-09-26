import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useWorkspacesStore } from './workspaces'

export const useTerminalStore = defineStore('terminal', () => {
  const projects = useWorkspacesStore()
  // projectId → ttyId
  const sessions = ref<Map<string, string>>(new Map())

  function registerTty(projectId: string, ttyId: string): void {
    sessions.value.set(projectId, ttyId)
    // 触发响应式
    sessions.value = new Map(sessions.value)
  }

  function clearTty(projectId: string): void {
    sessions.value.delete(projectId)
    sessions.value = new Map(sessions.value)
  }

  function getActiveTtyId(): string | null {
    const id = projects.activeId
    if (!id) return null
    return sessions.value.get(id) ?? null
  }

  return { sessions, registerTty, clearTty, getActiveTtyId }
})
