import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AiTaskSummary, Workspace } from '@shared/types'
import { call } from '@/lib/api'
import { resolveAiTaskNavigation } from '@/lib/ai-tasks/navigation'
import { createPreviewProjectContext } from '@/lib/preview/preview-project'
import { useUiStore } from './ui'
import { useWorkspacesStore } from './workspaces'
import { usePreviewStore } from './preview'

function isAiTaskSummary(value: unknown): value is AiTaskSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<AiTaskSummary>
  return typeof item.id === 'string'
    && typeof item.sessionId === 'string'
    && typeof item.workspaceId === 'string'
}

function resolveOpenWorkspace(task: AiTaskSummary, workspaces: Workspace[]): Workspace | undefined {
  const direct = workspaces.find((item) => item.id === task.workspaceId)
  if (direct && !direct.hidden) return direct
  const parentId = task.baseWorkspaceId ?? direct?.parentWorkspaceId ?? direct?.baseWorkspaceId
  if (parentId) {
    const parent = workspaces.find((item) => item.id === parentId && !item.hidden)
    if (parent) return parent
  }
  return undefined
}

export const useAiTasksStore = defineStore('ai-tasks', () => {
  const tasks = ref<AiTaskSummary[]>([])
  const loading = ref(false)
  let unsubscribeChanged: (() => void) | null = null
  let watcherConsumers = 0

  const activeCount = computed(() =>
    tasks.value.filter((task) => task.status === 'running').length
  )
  const waitingCount = computed(() =>
    tasks.value.filter((task) => task.status === 'waiting_user' || task.status === 'waiting_approval').length
  )

  async function load(): Promise<void> {
    loading.value = true
    try {
      const result = await call('aiTask.list', undefined)
      if (result.ok) tasks.value = result.data
    } finally {
      loading.value = false
    }
  }

  function startWatching(): void {
    watcherConsumers += 1
    if (unsubscribeChanged || !window.events) return
    unsubscribeChanged = window.events.on('ai-task.changed', (payload: unknown) => {
      if (isAiTaskSummary(payload)) {
        upsertLocal(payload)
        notifyPreviewFilesChanged(payload)
      } else {
        void load()
      }
    })
  }

  function stopWatching(): void {
    watcherConsumers = Math.max(0, watcherConsumers - 1)
    if (watcherConsumers > 0) return
    unsubscribeChanged?.()
    unsubscribeChanged = null
  }

  function upsertLocal(task: AiTaskSummary): void {
    const next = tasks.value.filter((item) => item.id !== task.id)
    next.push(task)
    tasks.value = next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  function notifyPreviewFilesChanged(task: AiTaskSummary): void {
    if (task.status !== 'completed' || task.changedArtifacts.length === 0) return
    const rootRelPath = task.workArea.kind === 'feature' || task.workArea.kind === 'ui-product'
      ? task.workArea.relPath.replace(/\\/g, '/').replace(/\/+$/, '')
      : null
    if (!rootRelPath) return
    const preview = usePreviewStore()
    preview.notifyProductFilesChanged({ workspaceId: task.workspaceId, rootRelPath })
    if (task.baseWorkspaceId && task.baseWorkspaceId !== task.workspaceId) {
      preview.notifyProductFilesChanged({ workspaceId: task.baseWorkspaceId, rootRelPath })
    }
  }

  async function openTask(task: AiTaskSummary): Promise<void> {
    const workspaces = useWorkspacesStore()
    const ui = useUiStore()
    const preview = usePreviewStore()
    let workspace = resolveOpenWorkspace(task, workspaces.list)
    if (!workspace) {
      await workspaces.refresh()
      workspace = resolveOpenWorkspace(task, workspaces.list)
    }
    if (!workspace) {
      ui.showToast('error', '任务所属项目不存在或已隐藏，无法打开', 5000)
      return
    }
    const workspaceId = workspace.id
    if (workspaces.activeId !== workspaceId) {
      await workspaces.setActive(workspaceId)
    }

    const nav = resolveAiTaskNavigation(task, workspace?.kind)
    if (workspace?.kind === 'ux' && nav.uxNode) {
      ui.setUxActiveNode(nav.uxNode)
    }
    if (nav.projectView === 'features-page') ui.openFeaturesPage()
    else ui.backToProjectHome()
    if (nav.openTerminal) {
      ui.openTerminalPanel({ kind: 'workspace-home', workspaceId })
    }
    // 任务绑到具体 ui-product / feature / document 的话，顺势打开对应的预览 tab，
    // 让用户点"打开"后能直接看到自己修改的目标，不用再手动导航一层。
    await openTaskWorkAreaPreview(task, preview, workspaceId)
  }

  async function openTaskWorkAreaPreview(
    task: AiTaskSummary,
    preview: ReturnType<typeof usePreviewStore>,
    workspaceId: string
  ): Promise<void> {
    const area = task.workArea
    if (area.kind !== 'ui-product' || !area.relPath) return
    const relPath = area.relPath.replace(/\/+$/, '')
    const htmlRelPath = `${relPath}/index.html`
    const title = relPath.split('/').filter(Boolean).at(-1) ?? relPath
    const project = createPreviewProjectContext(
      workspaceId,
      useWorkspacesStore().personalSpace?.slug ?? '__public__',
      relPath,
      title
    )
    preview.openProject({
      project,
      primaryRelPath: htmlRelPath
    })
  }

  async function openTaskById(taskId: string): Promise<void> {
    const local = tasks.value.find((task) => task.id === taskId)
    if (local) {
      await openTask(local)
      return
    }

    const result = await call('aiTask.get', { taskId })
    if (result.ok && result.data) {
      await openTask(result.data)
    }
  }

  async function abortTask(task: AiTaskSummary): Promise<boolean> {
    const result = await call('aiTask.abort', { taskId: task.id })
    if (!result.ok || !result.data.ok) return false
    await load()
    return true
  }

  // 从列表里移除任务记录（如果还在跑，先自动 abort）。不影响文件、不动 worktree。
  async function dismissTask(task: AiTaskSummary): Promise<boolean> {
    const result = await call('aiTask.dismiss', { taskId: task.id })
    if (!result.ok || !result.data.ok) return false
    tasks.value = tasks.value.filter((item) => item.id !== task.id)
    return true
  }

  return {
    tasks,
    loading,
    activeCount,
    waitingCount,
    load,
    startWatching,
    stopWatching,
    openTask,
    openTaskById,
    abortTask,
    dismissTask
  }
})
