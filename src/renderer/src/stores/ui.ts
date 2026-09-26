import { defineStore } from 'pinia'
import { ref } from 'vue'
import { call } from '@/lib/api'
import {
  buildStartupEnvironmentNotice,
  type StartupEnvironmentNotice
} from '@/lib/startup-environment'
import { buildCommitPromptMessage } from '@/lib/dirty-changes'
import type { TerminalOpenContext } from '@/lib/terminal/terminal-context'

type RuntimeInfo = {
  version: string
  electron: string
  node: string
  chrome: string
}

export type SettingsTab = 'appearance' | 'credentials' | 'ssh' | 'cli' | 'extension' | 'diagnostics' | 'about'

type ConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
}

type PromptOption = {
  label: string
  value: string
  description?: string
}

type PromptRequest = {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  options?: PromptOption[]
  // multiline=true 渲染 textarea；默认 input
  multiline?: boolean
  // 返回 string = 用户提交的值；返回 null = 取消
  onSubmit: (value: string | null) => void
}

export type UiProductRenameInput = {
  coverTag: string
  uxName: string
  pmName: string
  name: string
}

export type UiProductRenameRequest = {
  title: string
  message?: string
  productName: string
  coverTag?: string
  uxName?: string
  pmName?: string
  confirmLabel?: string
  onSubmit: (value: UiProductRenameInput | null) => void
}

export type AiRepairPromptRequest = {
  title: string
  message: string
  prompt: string
  // 可选：放弃并清理（团队推送冲突保留的临时 worktree）。仅团队推送冲突场景设置。
  abort?: { workspaceId: string; worktreePath: string }
}

type BranchHistoryRequest = {
  workspaceId: string
  workspaceName?: string
  branch?: string
  defaultBranch?: string
  relPath?: string
  initialView?: 'pushes' | 'commits'
}

export type SyncMode = 'remote' | 'mainline' | 'full'

export type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

// UI 状态：弹窗、栏宽、toast 等。集中放，避免子组件彼此通信。
export const useUiStore = defineStore('ui', () => {
  const settingsOpen = ref(false)
  const settingsInitialTab = ref<SettingsTab>('credentials')

  function openSettings(tab: SettingsTab = 'credentials'): void {
    settingsInitialTab.value = tab
    settingsOpen.value = true
  }

  // 中央区域显示模式：
  // - home: 工作台首页（输入需求创建项目 + 最近项目）
  // - project-management / features-page: 内部项目管理
  // - ai-config: 资源包
  // - skills-config: 技能
  // - external-view: 外部库（知识库 / UI 资产）查看页
  // - onboarding-guide: 新手引导
  //
  // 历史：老 'requirement-work' view 在 Phase E 已废弃；
  // viewingRequirementIdSlug 保留为 null 兜底（sidebar 老高亮逻辑仍在引用）。
  type ProjectView = 'home' | 'project-management' | 'project-home' | 'features-page' | 'ai-config' | 'skills-config' | 'external-view' | 'onboarding-guide'
  const currentView = ref<ProjectView>('home')
  // 从 AI 配置点 打开/编辑 跳走时，记一下返回锚点，让 ExternalRefViewer / editor
  // 关闭后回到 AI 配置而不是项目首页。
  const externalViewReturnTo = ref<ProjectView>('project-home')
  const editorReturnTo = ref<ProjectView>('project-home')
  const viewingRequirementIdSlug = ref<string | null>(null)
  const viewingExternalAlias = ref<string | null>(null)
  const viewingExternalRelPath = ref<string | null>(null)

  function openFeaturesPage(): void {
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'features-page'
  }
  function openHome(): void {
    closeTerminalPanel()
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'home'
  }
  function openProjectManagement(): void {
    closeTerminalPanel()
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'project-management'
  }
  function openResources(): void {
    closeTerminalPanel()
    openAiConfig()
  }
  function openSkills(): void {
    closeTerminalPanel()
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'skills-config'
  }
  function openGuide(): void {
    closeTerminalPanel()
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'onboarding-guide'
  }
  function openAiConfig(): void {
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'ai-config'
  }
  function openExternalView(alias: string, relPath?: string): void {
    externalViewReturnTo.value = currentView.value === 'ai-config' ? 'ai-config' : 'project-management'
    viewingExternalAlias.value = alias
    viewingExternalRelPath.value = relPath ?? null
    viewingRequirementIdSlug.value = null
    currentView.value = 'external-view'
  }
  function closeExternalView(): void {
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    if (currentView.value === 'external-view') {
      currentView.value = externalViewReturnTo.value
    }
  }
  function backToProjectHome(): void {
    viewingRequirementIdSlug.value = null
    viewingExternalAlias.value = null
    viewingExternalRelPath.value = null
    currentView.value = 'features-page'
  }
  // 编辑器（Markdown 等）打开时记一下当前视图。
  // 当前 editor.close 通过 v-else-if 链回落，currentView 自然被保留——所以这是
  // 一道安全网：如果未来编辑器路径动到 currentView，可以读 resolveEditorReturnView()。
  function rememberEditorReturnView(): void {
    editorReturnTo.value = currentView.value === 'ai-config' || currentView.value === 'skills-config' || currentView.value === 'features-page'
      ? currentView.value
      : 'project-home'
  }
  function resolveEditorReturnView(): ProjectView {
    return editorReturnTo.value
  }

  // Workspace v2 新对话框开关
  const newWorkspaceOpen = ref(false)
  // UX 个人空间对话框：导入 UX 项目后引导创建；isFirstTime 只影响文案，允许跳过。
  const personalSpaceOpen = ref<{ workspaceId: string; isFirstTime?: boolean } | null>(null)
  function openPersonalSpace(workspaceId: string, isFirstTime?: boolean): void {
    personalSpaceOpen.value = { workspaceId, isFirstTime }
  }
  function closePersonalSpace(): void {
    personalSpaceOpen.value = null
  }
  // UX 页面当前选中节点：侧边栏与顶部 tab 共享，任一入口切换都改这里。
  // 'home' = 点 ui-2-code 根行的项目首页（工作空间管理 + AI 配置），默认；
  // 'assets' 同时承载主题与组件（资产库化重构）。
  type UxNode = 'home' | 'assets' | 'images' | 'outputs' | 'skills'
  const uxActiveNode = ref<UxNode>('home')
  function setUxActiveNode(node: UxNode): void {
    uxActiveNode.value = node
  }
  const createProductRequest = ref(0)
  function requestCreateProduct(): void {
    createProductRequest.value += 1
  }
  // 添加外部库对话框：携带默认 category（'knowledge' 或 'uikit'）
  const addExternalRefOpen = ref<{ defaultCategory: 'knowledge' | 'uikit' } | false>(false)
  // 同步 / 冲突解决对话框：携带数据
  const syncProgress = ref<{ workspaceId: string; mode?: SyncMode; commitMessage?: string } | null>(null)
  const conflictResolve = ref<{ workspaceId: string; trigger: 'sync' | 'mainline' } | null>(null)
  const aiRepairPrompt = ref<AiRepairPromptRequest | null>(null)
  const branchHistory = ref<BranchHistoryRequest | null>(null)

  const confirmDanger = ref<ConfirmRequest | null>(null)
  const promptOpen = ref<PromptRequest | null>(null)
  const uiProductRenameOpen = ref<Omit<UiProductRenameRequest, 'onSubmit'> & { onSubmit: UiProductRenameRequest['onSubmit'] } | null>(null)
  const sidebarWidth = ref(220)
  const sidebarCollapsed = ref(false)
  const terminalWidth = ref(420)
  const terminalPanelOpen = ref(false)
  const terminalOpenContext = ref<TerminalOpenContext | null>(null)
  const pendingConversationDraft = ref<{ id: number; text: string } | null>(null)
  const aiTaskPanelOpen = ref(false)
  let conversationDraftId = 0

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function openTerminalPanel(context?: TerminalOpenContext): void {
    terminalOpenContext.value = context ?? null
    terminalPanelOpen.value = true
  }

  function closeTerminalPanel(): void {
    terminalPanelOpen.value = false
    terminalOpenContext.value = null
  }

  function queueConversationDraft(text: string): void {
    const value = text.trim()
    if (!value) return
    pendingConversationDraft.value = { id: ++conversationDraftId, text: value }
  }

  function consumeConversationDraft(id: number): void {
    if (pendingConversationDraft.value?.id === id) pendingConversationDraft.value = null
  }

  function openAiTaskPanel(): void {
    aiTaskPanelOpen.value = true
  }

  function closeAiTaskPanel(): void {
    aiTaskPanelOpen.value = false
  }

  function openSyncProgress(workspaceId: string, commitMessage?: string, mode: SyncMode = 'full'): void {
    syncProgress.value = { workspaceId, commitMessage, mode }
  }
  function closeSyncProgress(): void {
    syncProgress.value = null
  }
  function openConflictResolve(workspaceId: string, trigger: 'sync' | 'mainline' = 'sync'): void {
    conflictResolve.value = { workspaceId, trigger }
  }
  function closeConflictResolve(): void {
    conflictResolve.value = null
  }
  function openAiRepairPrompt(req: AiRepairPromptRequest): void {
    aiRepairPrompt.value = req
  }
  function closeAiRepairPrompt(): void {
    aiRepairPrompt.value = null
  }
  function closeGitOperationDialogs(): void {
    syncProgress.value = null
    aiRepairPrompt.value = null
  }
  function openBranchHistory(req: BranchHistoryRequest): void {
    branchHistory.value = req
  }
  function closeBranchHistory(): void {
    branchHistory.value = null
  }

  function askConfirm(req: ConfirmRequest): void {
    confirmDanger.value = req
  }

  // App 内置 prompt（Electron 主窗口禁用了原生 window.prompt）。
  // 用法：const v = await askPrompt({ title: '...', defaultValue: '...' })
  function askPrompt(req: Omit<PromptRequest, 'onSubmit'>): Promise<string | null> {
    return new Promise((resolve) => {
      promptOpen.value = {
        ...req,
        onSubmit: (v) => {
          promptOpen.value = null
          resolve(v)
        }
      }
    })
  }

  function askUiProductRename(req: Omit<UiProductRenameRequest, 'onSubmit'>): Promise<UiProductRenameInput | null> {
    return new Promise((resolve) => {
      uiProductRenameOpen.value = {
        ...req,
        coverTag: req.coverTag ?? '',
        uxName: req.uxName ?? '',
        pmName: req.pmName ?? '',
        onSubmit: (value) => {
          uiProductRenameOpen.value = null
          resolve(value)
        }
      }
    })
  }

  // 切需求 / 完成需求 / 同步等触发"必须先保存"时统一调这个，给用户一句版本说明。
  function askCommitMessage(reason: string, details?: unknown): Promise<string | null> {
    return askPrompt({
      title: '保存当前进度',
      message: buildCommitPromptMessage(reason, details),
      placeholder: '例如：完成登录页结构调整',
      confirmLabel: '保存',
      multiline: true
    })
  }

  const toasts = ref<Toast[]>([])
  let toastSeq = 0
  function showToast(kind: Toast['kind'], message: string, durationMs = 3500): void {
    const id = ++toastSeq
    toasts.value = [...toasts.value, { id, kind, message }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, durationMs)
  }
  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  // IDE 唤起反馈：spawn 是异步的（IPC 立即返回），但 IDE 窗口要 1-3s 才出来。
  // 这一段维持一个全局"正在打开 IDE"指示，让用户知道点击有反馈。
  const ideLaunching = ref(false)
  const ideLaunchLabel = ref('')

  async function withIdeLaunchFeedback<T>(label: string, fn: () => Promise<T>): Promise<T> {
    ideLaunching.value = true
    ideLaunchLabel.value = label
    try {
      const result = await fn()
      // IPC 已返回（spawn 完成），但 IDE 窗口还在起，保持指示器再亮 1.5s
      setTimeout(() => {
        ideLaunching.value = false
        ideLaunchLabel.value = ''
      }, 1500)
      return result
    } catch (e) {
      ideLaunching.value = false
      ideLaunchLabel.value = ''
      throw e
    }
  }

  const runtime = ref<RuntimeInfo | null>(null)
  const ipcReady = ref<boolean | null>(null)   // null=未测，true=ok，false=fail
  const ipcError = ref<string | null>(null)    // 失败时的可读原因
  const startupEnvironmentNotice = ref<StartupEnvironmentNotice | null>(null)
  const startupEnvironmentChecked = ref(false)

  async function loadRuntimeInfo(): Promise<void> {
    const r = await call('app.version', undefined)
    if (r.ok) {
      runtime.value = r.data
      ipcReady.value = true
      ipcError.value = null
    } else {
      ipcReady.value = false
      ipcError.value = `${r.code}: ${r.message}`
      console.error('[ipc] app.version failed:', r)
    }
  }

  async function checkStartupEnvironment(): Promise<void> {
    if (startupEnvironmentChecked.value) return
    startupEnvironmentChecked.value = true

    const r = await call('setup.checkEnv', undefined)
    if (!r.ok) {
      showToast('error', `环境检查失败：${r.message}`, 6000)
      return
    }

    startupEnvironmentNotice.value = buildStartupEnvironmentNotice(r.data)
  }

  // claude / cursor / vscode 等可选依赖按需检测：
  // - claude-code 在打开 AI 面板（terminal）时调
  // - cursor / vscode 在 App 启动后台异步调，结果给 project-tool-menu 用
  // 不阻塞 splash。结果缓存在 store 里，重复调直接返回。
  type OptionalDepName = 'claude-code' | 'cursor' | 'vscode'
  type OptionalDepInfo = { found: boolean; version?: string; guideUrl?: string; checkedAt: number }
  const optionalDeps = ref<Partial<Record<OptionalDepName, OptionalDepInfo>>>({})
  const optionalDepInflight = new Map<OptionalDepName, Promise<OptionalDepInfo>>()

  async function ensureOptionalDep(name: OptionalDepName, opts: { force?: boolean } = {}): Promise<OptionalDepInfo> {
    const cached = optionalDeps.value[name]
    if (cached && !opts.force) return cached
    const inflight = optionalDepInflight.get(name)
    if (inflight) return inflight

    const p = (async () => {
      const r = await call('setup.checkOptionalDep', { name })
      const info: OptionalDepInfo = r.ok
        ? { found: r.data.found, version: r.data.version, guideUrl: r.data.guideUrl, checkedAt: Date.now() }
        : { found: false, checkedAt: Date.now() }
      optionalDeps.value = { ...optionalDeps.value, [name]: info }
      return info
    })()
    optionalDepInflight.set(name, p)
    p.finally(() => optionalDepInflight.delete(name))
    return p
  }

  // 启动后异步触发 IDE 探测（cursor / vscode）。打开 AI 面板时单独调 claude。
  function detectIdesInBackground(): void {
    void ensureOptionalDep('cursor').catch(() => undefined)
    void ensureOptionalDep('vscode').catch(() => undefined)
  }

  // 打开 AI 面板时调；没装 claude-code 弹 toast 引导
  async function ensureClaudeOrWarn(): Promise<boolean> {
    const info = await ensureOptionalDep('claude-code')
    if (info.found) return true
    showToast(
      'error',
      '未检测到 Claude Code。AI 面板需要它支持，请按指南安装后重启 App。',
      8000
    )
    return false
  }

  function dismissStartupEnvironmentNotice(): void {
    startupEnvironmentNotice.value = null
  }

  async function openStartupEnvironmentGuide(): Promise<void> {
    if (startupEnvironmentNotice.value?.primaryActionKind === 'settings') {
      openSettings('credentials')
      startupEnvironmentNotice.value = null
      return
    }

    const url = startupEnvironmentNotice.value?.primaryActionUrl
    if (!url) return

    const r = await call('system.openExternal', { url })
    if (!r.ok) {
      showToast('error', `打开指南失败：${r.message}`, 6000)
      return
    }
    startupEnvironmentNotice.value = null
  }

  return {
    settingsOpen,
    settingsInitialTab,
    openSettings,
    currentView,
    viewingRequirementIdSlug,
    viewingExternalAlias,
    viewingExternalRelPath,
    openFeaturesPage,
    openHome,
    openProjectManagement,
    openResources,
    openSkills,
    openGuide,
    openAiConfig,
    openExternalView,
    closeExternalView,
    backToProjectHome,
    rememberEditorReturnView,
    resolveEditorReturnView,
    newWorkspaceOpen,
    personalSpaceOpen,
    openPersonalSpace,
    closePersonalSpace,
    uxActiveNode,
    setUxActiveNode,
    createProductRequest,
    requestCreateProduct,
    addExternalRefOpen,
    syncProgress,
    conflictResolve,
    aiRepairPrompt,
    branchHistory,
    openSyncProgress,
    closeSyncProgress,
    openConflictResolve,
    closeConflictResolve,
    openAiRepairPrompt,
    closeAiRepairPrompt,
    closeGitOperationDialogs,
    openBranchHistory,
    closeBranchHistory,
    confirmDanger,
    askConfirm,
    promptOpen,
    askPrompt,
    uiProductRenameOpen,
    askUiProductRename,
    askCommitMessage,
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebar,
    terminalWidth,
    terminalPanelOpen,
    terminalOpenContext,
    pendingConversationDraft,
    aiTaskPanelOpen,
    openTerminalPanel,
    closeTerminalPanel,
    queueConversationDraft,
    consumeConversationDraft,
    openAiTaskPanel,
    closeAiTaskPanel,
    runtime,
    ipcReady,
    ipcError,
    loadRuntimeInfo,
    startupEnvironmentNotice,
    checkStartupEnvironment,
    optionalDeps,
    ensureOptionalDep,
    detectIdesInBackground,
    ensureClaudeOrWarn,
    dismissStartupEnvironmentNotice,
    openStartupEnvironmentGuide,
    toasts,
    showToast,
    dismissToast,
    ideLaunching,
    ideLaunchLabel,
    withIdeLaunchFeedback
  }
})
