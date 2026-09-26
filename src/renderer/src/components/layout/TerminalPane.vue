<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useTerminalStore } from '@/stores/terminal'
import { useConversationStore } from '@/stores/conversation'
import { usePreviewStore } from '@/stores/preview'
import { useEditorStore } from '@/stores/editor'

type Mode = 'ui' | 'tui'

// 每工作区记一份模式选择（内存）。首次进入时从磁盘恢复；切换时写回。
// 默认 UI 模式（自研 chat 视图）。用户显式选过 tui 才落 tui。
const modeByWorkspace = ref<Map<string, Mode>>(new Map())
async function loadModeFor(workspaceId: string, workspacePath: string): Promise<Mode> {
  if (modeByWorkspace.value.has(workspaceId)) return modeByWorkspace.value.get(workspaceId)!
  const exists = await call('editor.entryExists', {
    workspaceId,
    relPath: '.ui-client/terminal-mode'
  })
  if (!exists.ok || !exists.data.exists) {
    modeByWorkspace.value.set(workspaceId, 'ui')
    void workspacePath
    return 'ui'
  }
  const r = await call('editor.readTextFile', {
    workspaceId,
    relPath: '.ui-client/terminal-mode'
  })
  const persisted = r.ok ? (r.data.content.trim() === 'tui' ? 'tui' : 'ui') : 'ui'
  modeByWorkspace.value.set(workspaceId, persisted)
  void workspacePath
  return persisted
}
async function persistModeFor(workspaceId: string, mode: Mode): Promise<void> {
  modeByWorkspace.value.set(workspaceId, mode)
  // 写入磁盘失败不阻塞切换
  await call('editor.writeTextFile', {
    workspaceId,
    relPath: '.ui-client/terminal-mode',
    content: mode
  }).catch(() => undefined)
}
import {
  EDITOR_DOCUMENT_OPENED_EVENT,
  isEditorDocumentOpenedDetail
} from '@/lib/editor/editor-document-events'
import {
  resolveTerminalContext,
  type TerminalTargetDocument,
  type TerminalTargetWorkspace
} from '@/lib/terminal/terminal-context'
import {
  resolveClaudeWorkAreaFromTargets,
  type ClaudeWorkArea,
  type PreviewWorkAreaTarget
} from '@/lib/terminal/terminal-work-area'
import { calculateTerminalResizeWidth } from '@/lib/terminal/terminal-resize'
import { storeToRefs } from 'pinia'
import ConversationView from '@/components/chat/ConversationView.vue'

const props = withDefaults(defineProps<{
  suppressHeader?: boolean
}>(), {
  suppressHeader: false
})

const uiStore = useUiStore()
const activeStore = useWorkspacesStore()
const terminalStore = useTerminalStore()
const conversationStore = useConversationStore()
const previewStore = usePreviewStore()
const editorStore = useEditorStore()
const { active } = storeToRefs(activeStore)
const project = active // 保留命名兼容下方代码
const xtermContainer = ref<HTMLDivElement>()
const status = ref<'idle' | 'spawning' | 'ok' | 'error'>('idle')
const errorMsg = ref<string>('')

const hasProject = computed(() => !!project.value)
const visiblePreviewTab = computed(() => {
  const tab = previewStore.activeTab
  if (!previewStore.isPreviewActive || tab?.workspaceId !== project.value?.id) return null
  return tab
})
const visibleAiProject = computed(() => visiblePreviewTab.value?.project ?? null)
const projectNameLabel = computed(() => visibleAiProject.value?.name ?? project.value?.name ?? '未打开项目')
const currentMode = computed<Mode>(() => {
  if (!project.value) return 'ui'
  return modeByWorkspace.value.get(project.value.id) ?? 'ui'
})
const currentDocumentTarget = computed(() => currentTargetDocument())
// Claude 的工作上下文：有可编辑文档 = 写入限制到该文档目录；否则 = 写入工作区根。
const resolvedTerminalContext = computed(() => resolveTerminalContext(currentDocumentTarget.value))
const scopeLabel = computed(() => {
  if (resolvedTerminalContext.value.scope === 'document') {
    return `📄 ${resolvedTerminalContext.value.activeWorkspace ?? '文档'}`
  }
  const workArea = currentClaudeWorkArea()
  if (workArea?.kind === 'feature') return `📁 ${workArea.relPath}`
  if (workArea?.kind === 'ui-component') return `🧩 ${workArea.relPath}`
  if (workArea?.kind === 'ui-product') return `🎨 ${workArea.relPath}`
  return '📁 工作区'
})
const conversationTargetDocument = computed(() => resolvedTerminalContext.value.targetDocument ?? null)
const conversationTargetWorkspace = computed(() => currentConversationTargetWorkspace() ?? null)
const activeAiProjectKey = computed(() =>
  visibleAiProject.value?.key
  ?? `${project.value?.id ?? 'none'}::${project.value?.path ?? 'none'}::workspace`
)
const canCloseManualPanel = computed(() =>
  uiStore.terminalPanelOpen && !previewStore.isPreviewActive && !editorStore.isOpen
)

let term: Terminal | null = null
let fit: FitAddon | null = null
let ttyId: string | null = null
let unsubData: (() => void) | null = null
let unsubExit: (() => void) | null = null
let unsubDelta: (() => void) | null = null
let unsubJsonlAppend: (() => void) | null = null
let unsubTurnEnd: (() => void) | null = null
let unsubTurnError: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let pendingStart = false
let activeUiTargetDocument: UiTargetDocument | undefined
let activeUiTargetWorkspace: UiTargetWorkspace | undefined
let currentWatchId: string | null = null
let componentDisposed = false

type UiTargetDocument = TerminalTargetDocument
type UiTargetWorkspace = TerminalTargetWorkspace
type UiInitOptions = {
  forceNew?: boolean
  expectedContextKey?: string
}
type PrepareSubmitSessionRequest = {
  targetDocument?: UiTargetDocument
  targetWorkspace?: UiTargetWorkspace
  resolve: (sessionId: string) => void
  reject: (message: string) => void
}

type ClaudeDeltaEvent = { type: string; uuid: string; [key: string]: unknown }
type ClaudeJsonlEvent = { type: string; uuid?: string; [key: string]: unknown }
type ClaudeTurnErrorEvent = { message?: string; errorMessage?: string; phase?: string; details?: unknown }

function isClaudeDeltaEvent(value: unknown): value is ClaudeDeltaEvent {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.type === 'string' && typeof record.uuid === 'string'
}

function isClaudeJsonlEvent(value: unknown): value is ClaudeJsonlEvent {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).type === 'string'
}

function isClaudeJsonlEvents(value: unknown): value is ClaudeJsonlEvent[] {
  return Array.isArray(value) && value.every(isClaudeJsonlEvent)
}

function messageFromClaudeTurnError(value: unknown): string {
  const payload = value && typeof value === 'object' ? value as ClaudeTurnErrorEvent : null
  const message = payload?.errorMessage ?? payload?.message
  if (message) return message
  return typeof value === 'string' ? value : 'Claude 服务端连接异常'
}

function currentClaudeWorkArea(): ClaudeWorkArea {
  return resolveClaudeWorkAreaFromTargets({
    workspaceKind: project.value?.kind,
    preview: currentPreviewWorkAreaTarget(),
    targetDocument: currentTargetDocument()
  })
}

function currentPreviewWorkAreaTarget(): PreviewWorkAreaTarget | undefined {
  const tab = visiblePreviewTab.value
  if (tab?.type === 'product' && tab.productMeta?.path) {
    return { type: 'product', path: tab.productMeta.path }
  }
  if (tab?.type === 'component' && tab.componentMeta?.path) {
    return { type: 'component', path: tab.componentMeta.path }
  }
  if (tab?.type === 'files' && tab.filesMeta?.rootRelPath) {
    return { type: 'files', rootRelPath: tab.filesMeta.rootRelPath }
  }
  return undefined
}

function currentPreviewWorkAreaKey(): string {
  const target = currentPreviewWorkAreaTarget()
  if (!target) return ''
  if (target.type === 'files') return `${target.type}:${target.rootRelPath}`
  return `${target.type}:${target.path}`
}

function currentConversationTargetWorkspace(): UiTargetWorkspace | undefined {
  const workArea = currentClaudeWorkArea()
  if (workArea && workArea.kind !== 'document') {
    return { kind: 'workspace-home', scopeKey: `${workArea.kind}:${workArea.relPath}` }
  }
  if (resolvedTerminalContext.value.targetDocument) return undefined
  return resolvedTerminalContext.value.targetWorkspace
}

function currentSessionTargetKey(): string {
  const target = currentConversationTargetWorkspace()
  const document = currentTargetDocument()
  return [
    project.value?.id ?? '',
    project.value?.path ?? '',
    activeAiProjectKey.value,
    target?.scopeKey ?? '',
    document?.relPath ?? ''
  ].join('|')
}

let lastSyncedWorkAreaKey = ''
async function syncClaudeWorkArea(): Promise<boolean> {
  if (!project.value) return false
  const area = currentClaudeWorkArea()
  const key = `${project.value.id}:${area?.kind ?? 'workspace'}:${area?.relPath ?? ''}:${currentSessionTargetKey()}`
  if (key === lastSyncedWorkAreaKey) return true
  const result = await call('workspace.setWorkArea', {
    workspaceId: project.value.id,
    area
  })
  if (!result.ok) {
    status.value = 'error'
    errorMsg.value = result.message
    uiStore.showToast('error', `Claude 工作区准备失败：${result.message}`, 6000)
    return false
  }
  lastSyncedWorkAreaKey = key
  return true
}

async function clearClaudeWorkArea(workspaceId: string): Promise<void> {
  await call('workspace.setWorkArea', {
    workspaceId,
    area: null
  }).catch(() => undefined)
}

// ── UI 模式事件订阅 ──
// 诊断锚点：卡在"处理中"时，DevTools console 会依次打出：
//   [ui-events] subscribe / first delta / turn-end
// 如果只有 subscribe 没有 first delta/turn-end，就是 IPC 通道没打通或 sessionId 不匹配；
// 如果 first delta 打了但 turn-end 没打，就是 exit IPC 丢了；如果 turn-end 打了但 UI
// 仍卡住，说明 activeSessionId 和订阅的 sessionId 不同步。
let currentSubscribedSessionId: string | null = null
function subscribeUiEvents(sessionId: string) {
  unsubscribeUiEvents()
  currentSubscribedSessionId = sessionId
  console.info('[ui-events] subscribe', sessionId.slice(0, 8))
  let firstDeltaLogged = false
  unsubDelta = window.events.on(`claude.delta:${sessionId}`, (event: unknown) => {
    if (!isClaudeDeltaEvent(event)) return
    if (!firstDeltaLogged) {
      firstDeltaLogged = true
      console.info('[ui-events] first delta', sessionId.slice(0, 8), event.type)
    }
    status.value = 'ok'
    errorMsg.value = ''
    conversationStore.appendDelta(sessionId, event)
  })
  unsubJsonlAppend = window.events.on(`claude.jsonl-append:${sessionId}`, (events: unknown) => {
    if (isClaudeJsonlEvents(events)) conversationStore.replay(sessionId, events)
  })
  unsubTurnEnd = window.events.on(`claude.turn-end:${sessionId}`, (payload: unknown) => {
    const p = payload as {
      status: string
      changedArtifacts?: string[]
      outOfScopeArtifacts?: string[]
      editableRoots?: string[]
      errorMessage?: string
      exitCode?: number | null
    }
    console.info('[ui-events] turn-end', sessionId.slice(0, 8), p.status, {
      activeSessionMatches: conversationStore.activeSessionId === sessionId
    })
    // status 三态：completed / aborted（用户主动停止）/ error（CLI 异常退出）。
    // aborted 是用户预期中的行为，不弹 toast、不在会话里加红条系统消息。
    const status: 'completed' | 'aborted' | 'error' = p.status === 'completed'
      ? 'completed'
      : p.status === 'aborted' ? 'aborted' : 'error'
    const errorMessage = status === 'error'
      ? p.errorMessage || `AI 任务退出码：${p.exitCode ?? '未知'}`
      : undefined
    conversationStore.endTurn(sessionId, status, p.changedArtifacts ?? [], errorMessage)
    showOutOfScopeNotice(p.outOfScopeArtifacts ?? [], p.editableRoots ?? [])
    if (status === 'error') {
      showUiClaudeError(sessionId, errorMessage ?? 'Claude Code 执行失败')
    }
    // turn 完成后刷新所有产物预览，让设计师立即看到 claude 写盘的效果
    if (status === 'completed') previewStore.reloadAllProductTabs()
  })
  unsubTurnError = window.events.on(`claude.turn-error:${sessionId}`, (payload: unknown) => {
    showUiClaudeError(sessionId, messageFromClaudeTurnError(payload))
  })
}

function unsubscribeUiEvents() {
  if (currentSubscribedSessionId) {
    console.info('[ui-events] unsubscribe', currentSubscribedSessionId.slice(0, 8))
    currentSubscribedSessionId = null
  }
  unsubDelta?.(); unsubDelta = null
  unsubJsonlAppend?.(); unsubJsonlAppend = null
  unsubTurnEnd?.(); unsubTurnEnd = null
  unsubTurnError?.(); unsubTurnError = null
}

async function stopUiWatch(
  workspaceId: string,
  sessionId = conversationStore.activeSessionId ?? undefined,
  watchId = currentWatchId ?? undefined,
  targetDocument = activeUiTargetDocument,
  targetWorkspace = activeUiTargetWorkspace
): Promise<void> {
  if (!sessionId || !watchId) return
  await call('claude.watch.stop', {
    workspaceId,
    sessionId,
    watchId,
    targetDocument,
    targetWorkspace
  }).catch(() => undefined)
}

function showUiClaudeError(sessionId: string, message: string): void {
  setUiClaudeError(message)
  if (conversationStore.currentTurnInFlight) {
    conversationStore.endTurn(sessionId, 'error', [], message)
  }
}

function setUiClaudeError(message: string): void {
  status.value = 'error'
  errorMsg.value = message
  uiStore.showToast('error', `AI 执行失败：${message}`, 6000)
}

function showOutOfScopeNotice(files: string[], editableRoots: string[]): void {
  if (files.length === 0) return
  const shown = files.slice(0, 3).join('、')
  const more = files.length > 3 ? ` 等 ${files.length} 个文件` : ''
  const scope = editableRoots.length > 0 ? `当前编辑范围：${editableRoots.join('、')}` : ''
  uiStore.showToast(
    'info',
    `Claude 修改了编辑范围外的文件：${shown}${more}${scope ? `。${scope}` : ''}`,
    8000
  )
}

// ── 模式切换 ──
// UI 模式（headless spawn）和 TUI 模式（pty）跑在两套独立通道上，本质是两个进程。
// 切换 mode = 切换可见的 UI 渲染，不应该打断任一通道。具体策略：
//   - UI→TUI：保留 UI 事件订阅 + 不 abort UI in-flight turn。后台 turn 继续跑，
//     事件继续灌入 conversation store；用户切回时 UI 显示完整状态。
//   - TUI→UI：走一次轻量 ensure。相同上下文会直接复用；TUI 期间如果切了
//     分支或内部项目，则会在重新显示前绑定到正确会话。
async function switchMode(target: Mode): Promise<void> {
  if (!project.value) return
  if (currentMode.value === target) return

  if (target === 'ui') {
    // persistModeFor 会先同步切换视图再写盘；提前撤销就绪态，避免旧会话在
    // ensure 正确分支/scope 前暴露可点击的 interaction / approval。
    status.value = 'spawning'
    errorMsg.value = ''
  }
  await persistModeFor(project.value.id, target)

  if (target === 'tui') {
    // 不 unsubscribeUiEvents，不 abort UI turn —— UI 通道继续在后台跑
    await startForActiveProject()
  } else {
    await killCurrent()
    term?.clear()
    await queuedInitUiMode(undefined, undefined, {
      expectedContextKey: currentSessionTargetKey()
    })
  }
}

// 标记当前 UI 模式是否已经初始化过（订阅 + watch 都拉起来过）。
// switchMode 用它判断 TUI→UI 时要不要重新 init。
const uiSessionInitialized = ref(false)

function currentTargetDocument(): UiTargetDocument | undefined {
  const previewDocument = currentPreviewTargetDocument()
  if (previewDocument) return previewDocument
  if (!editorStore.isOpen) return undefined
  const session = editorStore.session
  if (!session || session.projectId !== project.value?.id || session.readonly) return undefined
  return {
    relPath: session.relPath,
    kind: session.kind,
    readonly: session.readonly
  }
}

function currentPreviewTargetDocument(): UiTargetDocument | undefined {
  const tab = visiblePreviewTab.value
  if (!tab || tab.type !== 'files') return undefined
  const relPath = tab.filesMeta?.activeRelPath
  if (!relPath) return undefined
  return {
    relPath,
    kind: targetDocumentKindFromRelPath(relPath)
  }
}

function targetDocumentKindFromRelPath(relPath: string): UiTargetDocument['kind'] {
  const lower = relPath.toLowerCase()
  if (/\.mdx?$/.test(lower)) return 'markdown'
  if (/\.css$/.test(lower)) return 'css'
  if (/\.html?$/.test(lower)) return 'html'
  return 'text'
}

async function initUiMode(
  targetDocument: UiTargetDocument | undefined = resolvedTerminalContext.value.targetDocument,
  targetWorkspace: UiTargetWorkspace | undefined = currentConversationTargetWorkspace(),
  options: UiInitOptions = {}
): Promise<string | null> {
  if (!project.value) return null
  if (!isExpectedUiContext(options.expectedContextKey)) return null
  const workspaceId = project.value.id
  const oldSessionId = conversationStore.activeSessionId
  const workAreaReady = await syncClaudeWorkArea()
  if (!workAreaReady) return null
  if (project.value?.id !== workspaceId || !isExpectedUiContext(options.expectedContextKey)) return null

  // 默认走 claude.sessionId（ensure 复用），切走再切回看到原对话；
  // forceNew=true 才强制创建新 sessionId（用户主动点"新会话"按钮时）。
  const ipc = options.forceNew ? 'claude.session.new' : 'claude.sessionId'
  const result = await call(ipc, {
    workspaceId,
    targetDocument,
    targetWorkspace
  })
  if (!result.ok) {
    setUiClaudeError(result.message)
    return null
  }
  if (project.value?.id !== workspaceId || !isExpectedUiContext(options.expectedContextKey)) return null

  const ensuredSessionId = result.data.sessionId
  if (
    !options.forceNew
    && oldSessionId === ensuredSessionId
    && uiSessionInitialized.value
    && currentWatchId
    && currentSubscribedSessionId === ensuredSessionId
    && isCurrentUiSessionTarget(targetDocument, targetWorkspace)
  ) {
    status.value = 'ok'
    return ensuredSessionId
  }

  if (!options.forceNew && oldSessionId && oldSessionId !== ensuredSessionId) {
    await stopUiWatch(workspaceId, oldSessionId)
    if (project.value?.id !== workspaceId || !isExpectedUiContext(options.expectedContextKey)) return null
  }
  // 仅在强制新会话时清空旧 store；ensure 复用时让 watch.start 的 replay 重建历史。
  if (options.forceNew && oldSessionId) conversationStore.clearSession(oldSessionId)
  return startUiSession(
    workspaceId,
    ensuredSessionId,
    targetDocument,
    targetWorkspace,
    options.expectedContextKey
  )
}

async function startUiSession(
  workspaceId: string,
  sessionId: string,
  targetDocument?: UiTargetDocument,
  targetWorkspace?: UiTargetWorkspace,
  expectedContextKey?: string
): Promise<string | null> {
  if (project.value?.id !== workspaceId || !isExpectedUiContext(expectedContextKey)) return null
  uiSessionInitialized.value = false
  currentWatchId = null
  activeUiTargetDocument = targetDocument
  activeUiTargetWorkspace = targetWorkspace
  conversationStore.setActiveSession(sessionId)
  subscribeUiEvents(sessionId)

  // 开始监听 JSONL
  const watchResult = await call('claude.watch.start', {
    workspaceId,
    sessionId,
    targetDocument,
    targetWorkspace
  })
  if (!watchResult.ok) {
    unsubscribeUiEvents()
    activeUiTargetDocument = undefined
    activeUiTargetWorkspace = undefined
    if (componentDisposed || !isExpectedUiContext(expectedContextKey)) return null
    if (conversationStore.activeSessionId === sessionId) {
      conversationStore.setActiveSession(null)
    }
    setUiClaudeError(watchResult.message)
    return null
  }
  const startedWatchId = watchResult.data.watchId
  if (project.value?.id !== workspaceId || !isExpectedUiContext(expectedContextKey)) {
    await call('claude.watch.stop', {
      workspaceId,
      sessionId: watchResult.data.sessionId,
      watchId: startedWatchId
    }).catch(() => undefined)
    unsubscribeUiEvents()
    return null
  }

  // main 端是会话绑定的事实源。若兼容性自愈切换了 ID，后续回放与事件订阅统一使用有效 ID。
  const effectiveSessionId = watchResult.data.sessionId
  currentWatchId = startedWatchId
  conversationStore.setActiveSession(effectiveSessionId)
  if (currentSubscribedSessionId !== effectiveSessionId) {
    subscribeUiEvents(effectiveSessionId)
  }

  // 历史回放：watch.start 通过 IPC 同步返回 jsonl 已有事件。之前这里被丢弃，
  // 导致同一会话内重新 watch（mode 切换 / 重订阅）时历史消息被清空。
  const replayEvents = watchResult.data.events
  if (Array.isArray(replayEvents) && replayEvents.length > 0 && isClaudeJsonlEvents(replayEvents)) {
    conversationStore.replay(effectiveSessionId, replayEvents, { historical: true })
  }
  if (watchResult.data.turnActive) {
    conversationStore.restoreRunningTurn(effectiveSessionId)
  }

  uiSessionInitialized.value = true
  status.value = 'ok'
  return effectiveSessionId
}

// 会话生命周期串行化：stop + start 和发送前的 ensure 使用同一队列，避免范围切换
// 尚未完成时自动提交或手动提交穿过清理窗口，造成 active session / 订阅短暂错位。
let uiSessionOperationQueue: Promise<unknown> = Promise.resolve()
function enqueueUiSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = uiSessionOperationQueue.then(operation)
  uiSessionOperationQueue = run.catch(() => undefined)
  return run
}

function queuedInitUiMode(
  targetDocument?: UiTargetDocument,
  targetWorkspace?: UiTargetWorkspace,
  options: UiInitOptions = {}
): Promise<string | null> {
  return enqueueUiSessionOperation(() => initUiMode(targetDocument, targetWorkspace, options))
}

async function abortUiTurn() {
  if (!project.value) return
  const sessionId = conversationStore.activeSessionId
  // 乐观清：立刻 dispatch turn.aborted，让 UI 即时响应（停止按钮 → 输入框可发）。
  // IPC 在后台 fire-and-await；失败再单独提示。否则用户在 IPC 链路（含 git status 等）
  // 慢的时候会看见"按了没反应"，又去重发，被 main 端 IN_FLIGHT 检查拒绝。
  if (sessionId) conversationStore.abortTurn(sessionId)
  const result = await call('claude.abort', {
    workspaceId: project.value.id,
    sessionId: sessionId ?? undefined,
    targetDocument: activeUiTargetDocument,
    targetWorkspace: activeUiTargetWorkspace
  })
  if (!result.ok) {
    setUiClaudeError(result.message)
  }
}

// 极端兜底：当 abort 链路或 driver 状态错乱、UI 看起来"卡住无法继续"时，
// 强制中止子进程并把前端 turn state reset 到可继续输入的状态。
// 复用 claude.abort（main 端 SIGTERM + 3s SIGKILL 兜底），不依赖 IPC 成功也能解放 UI。
async function forceResetClaudeUi() {
  if (!project.value) return
  const sessionId = conversationStore.activeSessionId
  // 乐观清：哪怕 IPC 全挂，UI 也能立刻解锁
  if (sessionId) conversationStore.abortTurn(sessionId)
  status.value = 'ok'
  errorMsg.value = ''
  uiStore.showToast('success', '已重置 AI 会话，可以继续对话', 3500)
  // IPC fire-and-await，失败仅日志（用户已经能继续操作）
  try {
    await call('claude.abort', {
      workspaceId: project.value.id,
      sessionId: sessionId ?? undefined,
      targetDocument: activeUiTargetDocument,
      targetWorkspace: activeUiTargetWorkspace
    })
  } catch (e) {
    console.warn('[force-reset] abort IPC threw:', e)
  }
}

async function newUiSession() {
  if (!project.value) return
  const targetDocument = resolvedTerminalContext.value.targetDocument
  const targetWorkspace = currentConversationTargetWorkspace()
  // 用户点"新会话"按钮 → 强制创建新 sessionId，覆盖当前 work-area 的持久化记录
  await queuedInitUiMode(targetDocument, targetWorkspace, {
    forceNew: true,
    expectedContextKey: currentSessionTargetKey()
  })
}

async function prepareSubmitSession(req: PrepareSubmitSessionRequest): Promise<void> {
  if (!project.value) {
    req.reject('项目不存在')
    return
  }

  // 每次发送都向 main 端确认当前 scope 的持久化 ID；同 ID 直接复用，
  // scope/分支变了才重绑 watcher。只有用户主动点「新会话」才创建新 ID。
  const sessionId = await queuedInitUiMode(req.targetDocument, req.targetWorkspace, {
    expectedContextKey: currentSessionTargetKey()
  })
  if (sessionId) req.resolve(sessionId)
  else req.reject(errorMsg.value || 'AI 会话初始化失败')
}

function isCurrentUiSessionTarget(
  targetDocument?: UiTargetDocument,
  targetWorkspace?: UiTargetWorkspace
): boolean {
  return activeUiTargetDocument?.relPath === targetDocument?.relPath
    && activeUiTargetDocument?.kind === targetDocument?.kind
    && activeUiTargetDocument?.readonly === targetDocument?.readonly
    && activeUiTargetWorkspace?.kind === targetWorkspace?.kind
    && activeUiTargetWorkspace?.scopeKey === targetWorkspace?.scopeKey
    && activeUiTargetWorkspace?.intent === targetWorkspace?.intent
}

function isExpectedUiContext(expectedContextKey?: string): boolean {
  return !componentDisposed
    && (expectedContextKey === undefined || expectedContextKey === currentSessionTargetKey())
}

function switchUiSession(
  targetDocument: UiTargetDocument | undefined,
  targetWorkspace: UiTargetWorkspace | undefined,
  expectedContextKey: string
): Promise<void> {
  if (!project.value || !isExpectedUiContext(expectedContextKey)) return Promise.resolve()
  const workspaceId = project.value.id
  const previousSessionId = conversationStore.activeSessionId ?? undefined
  const previousWatchId = currentWatchId ?? undefined
  const previousTargetDocument = activeUiTargetDocument
  const previousTargetWorkspace = activeUiTargetWorkspace

  // 先同步撤销 renderer 就绪态，阻止新 ConversationView 在 stop IPC 等待期间自动提交。
  status.value = 'spawning'
  errorMsg.value = ''
  unsubscribeUiEvents()
  uiSessionInitialized.value = false
  currentWatchId = null
  activeUiTargetDocument = undefined
  activeUiTargetWorkspace = undefined
  conversationStore.setActiveSession(null)

  return enqueueUiSessionOperation(async () => {
    await stopUiWatch(
      workspaceId,
      previousSessionId,
      previousWatchId,
      previousTargetDocument,
      previousTargetWorkspace
    )
    if (project.value?.id !== workspaceId || !isExpectedUiContext(expectedContextKey)) return
    await initUiMode(targetDocument, targetWorkspace, { expectedContextKey })
  })
}


// ── TUI 模式（原逻辑保持不变） ──

async function killCurrent(): Promise<void> {
  unsubData?.(); unsubData = null
  unsubExit?.(); unsubExit = null
  if (ttyId) {
    if (project.value?.id) terminalStore.clearTty(project.value.id)
    await call('terminal.kill', { ttyId })
    ttyId = null
  }
}

function ensureTerm(): Terminal | null {
  if (term) return term
  if (!xtermContainer.value) return null

  term = new Terminal({
    fontSize: 12,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    cursorBlink: true,
    cursorStyle: 'bar',
    convertEol: true,
    scrollback: 5000,
    theme: {
      background: '#1c1c1e',
      foreground: '#f2f2f7',
      cursor: '#ff7a3d',
      selectionBackground: '#3a3a3c'
    }
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(xtermContainer.value)

  term.onData((data) => {
    if (ttyId) void call('terminal.write', { ttyId, data })
  })
  term.onResize(({ cols, rows }) => {
    if (ttyId) void call('terminal.resize', { ttyId, cols, rows })
  })

  resizeObserver = new ResizeObserver(() => {
    try { fit?.fit() } catch { /* ignore */ }
  })
  resizeObserver.observe(xtermContainer.value)

  return term
}

async function startForActiveProject(): Promise<void> {
  if (pendingStart) return
  if (!project.value) return
  const workspaceId = project.value.id
  pendingStart = true
  try {
    const t = ensureTerm()
    if (!t) return
    const workAreaReady = await syncClaudeWorkArea()
    if (!workAreaReady || componentDisposed || project.value?.id !== workspaceId) return

    await killCurrent()
    await new Promise(requestAnimationFrame)
    if (componentDisposed || project.value?.id !== workspaceId) return
    try { fit?.fit() } catch { /* ignore */ }

    t.clear()
    t.write(`\x1b[2m[WorkSpace] 编辑范围: ${scopeLabel.value}\x1b[0m\r\n`)

    status.value = 'spawning'
    errorMsg.value = ''
    const r = await call('terminal.create', {
      cols: t.cols,
      rows: t.rows
    })
    if (componentDisposed || project.value?.id !== workspaceId) {
      if (r.ok) await call('terminal.kill', { ttyId: r.data.ttyId }).catch(() => undefined)
      return
    }
    if (!r.ok) {
      status.value = 'error'
      errorMsg.value = `${r.code}: ${r.message}`
      t.write(`\r\n\x1b[31m[启动失败] ${r.message}\x1b[0m\r\n`)
      return
    }

    ttyId = r.data.ttyId
    status.value = 'ok'
    terminalStore.registerTty(workspaceId, ttyId)

    unsubData = window.events.on(`pty.data:${ttyId}`, (data: unknown) => {
      if (typeof data === 'string') term?.write(data)
    })
    unsubExit = window.events.on(`pty.exit:${ttyId}`, () => {
      term?.write('\r\n\x1b[33m[Claude Code 进程已退出]\x1b[0m\r\n')
      status.value = 'error'
      errorMsg.value = 'PTY 已退出'
    })
  } finally {
    pendingStart = false
  }
}

async function teardown(): Promise<void> {
  await killCurrent()
  term?.clear()
  status.value = 'idle'
  errorMsg.value = ''
}

onMounted(async () => {
  window.addEventListener(EDITOR_DOCUMENT_OPENED_EVENT, onEditorDocumentOpened)
  if (!project.value) return
  await loadModeFor(project.value.id, project.value.path)
  if (currentMode.value === 'ui') {
    await queuedInitUiMode(undefined, undefined, {
      expectedContextKey: currentSessionTargetKey()
    })
  } else {
    await startForActiveProject()
  }
})

watch(
  () => project.value?.id ?? '',
  async (next, prev) => {
    if (next === prev) return
    const expectedWorkspaceId = next
    const previousSessionId = conversationStore.activeSessionId ?? undefined
    const previousWatchId = currentWatchId ?? undefined
    const previousTargetDocument = activeUiTargetDocument
    const previousTargetWorkspace = activeUiTargetWorkspace

    status.value = 'spawning'
    errorMsg.value = ''
    unsubscribeUiEvents()
    uiSessionInitialized.value = false
    currentWatchId = null
    activeUiTargetDocument = undefined
    activeUiTargetWorkspace = undefined
    lastSyncedWorkAreaKey = ''
    conversationStore.setActiveSession(null)

    await enqueueUiSessionOperation(async () => {
      // 切根项目只停旧项目的 watcher，不 abort 后台任务；切回时会回放历史。
      if (prev) {
        await stopUiWatch(
          prev,
          previousSessionId,
          previousWatchId,
          previousTargetDocument,
          previousTargetWorkspace
        )
      }
      if ((project.value?.id ?? '') !== expectedWorkspaceId || componentDisposed) return
      if (!project.value) {
        await teardown()
        return
      }
      await loadModeFor(project.value.id, project.value.path)
      if ((project.value?.id ?? '') !== expectedWorkspaceId || componentDisposed) return
      if (currentMode.value === 'ui') {
        await initUiMode(undefined, undefined, {
          expectedContextKey: currentSessionTargetKey()
        })
      } else {
        await startForActiveProject()
      }
    })
  }
)

// 当前会话目标变化时，UI 模式切换到对应历史；TUI 运行中不重启，下一次启动时使用最新 workArea cwd。
watch(
  () => currentSessionTargetKey(),
  async (next, prev) => {
    if (next === prev) return
    if (!project.value) return
    if (currentMode.value === 'ui') {
      const targetDocument = resolvedTerminalContext.value.targetDocument
      const targetWorkspace = currentConversationTargetWorkspace()
      await switchUiSession(targetDocument, targetWorkspace, next)
    }
  }
)

watch(
  () => [
    project.value?.id ?? '',
    uiStore.terminalOpenContext?.kind ?? '',
    uiStore.terminalOpenContext?.workspaceId ?? '',
    currentPreviewWorkAreaKey(),
    currentTargetDocument()?.relPath ?? ''
  ].join('|'),
  () => {
    void syncClaudeWorkArea()
  }
)

// ── 拖拽调整宽度 ──
// 用 Pointer Events + setPointerCapture：拖动横向移动会经过预览 iframe，
// 鼠标 mouseup 在 iframe 内触发不冒泡到 parent document，drag 会卡住一直没结束。
// pointer capture 把事件流锁定到 grip 元素，跨 iframe 边界也不丢。
function startResize(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  const target = e.currentTarget as HTMLElement | null
  if (!target) return
  const startX = e.clientX
  const startWidth = uiStore.terminalWidth
  const pointerId = e.pointerId

  try { target.setPointerCapture(pointerId) } catch { /* ignore */ }

  function onPointerMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    uiStore.terminalWidth = calculateTerminalResizeWidth({
      startX,
      currentX: ev.clientX,
      startWidth,
      viewportWidth: window.innerWidth
    })
  }
  function cleanup(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    target!.removeEventListener('pointermove', onPointerMove)
    target!.removeEventListener('pointerup', cleanup)
    target!.removeEventListener('pointercancel', cleanup)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { target!.releasePointerCapture(pointerId) } catch { /* ignore */ }
  }

  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', cleanup)
  target.addEventListener('pointercancel', cleanup)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

onBeforeUnmount(() => {
  componentDisposed = true
  window.removeEventListener(EDITOR_DOCUMENT_OPENED_EVENT, onEditorDocumentOpened)
  resizeObserver?.disconnect()
  const workspaceId = project.value?.id
  const sessionId = conversationStore.activeSessionId ?? undefined
  const watchId = currentWatchId ?? undefined
  const targetDocument = activeUiTargetDocument
  const targetWorkspace = activeUiTargetWorkspace

  uiSessionInitialized.value = false
  currentWatchId = null
  unsubscribeUiEvents()
  activeUiTargetDocument = undefined
  activeUiTargetWorkspace = undefined
  if (workspaceId && sessionId && watchId) {
    void stopUiWatch(
      workspaceId,
      sessionId,
      watchId,
      targetDocument,
      targetWorkspace
    )
  }
  if (workspaceId) void clearClaudeWorkArea(workspaceId)
  void killCurrent()
  term?.dispose()
  term = null
})

function onEditorDocumentOpened(event: Event): void {
  const detail = (event as CustomEvent).detail
  if (!isEditorDocumentOpenedDetail(detail)) return
  if (!project.value || detail.projectId !== project.value.id) return
  // 打开新文档时 currentTargetDocument() 已自动更新；above watcher 会处理切换
}
</script>

<template>
  <aside
    class="relative flex flex-col bg-card"
    :style="{ width: uiStore.terminalWidth + 'px' }"
  >
    <div class="terminal-divider" aria-hidden="true" />
    <button
      type="button"
      class="terminal-resize-handle"
      title="拖动调整 AI 对话宽度"
      aria-label="拖动调整 AI 对话宽度"
    >
      <span
        class="terminal-resize-grip"
        aria-hidden="true"
        @pointerdown="startResize"
      />
    </button>

    <!-- Header：紧凑布局。scope 一键切换 + UI/TUI + 状态点 + 关闭 -->
    <div
      v-if="!props.suppressHeader"
      class="h-9 px-2 flex items-center gap-2 border-b border-border/60 text-xs"
    >
      <template v-if="hasProject">
        <span
          class="project-context-label"
          :title="`当前 AI 项目：${projectNameLabel}`"
        >
          <span class="project-context-dot" aria-hidden="true" />
          <span class="truncate">{{ projectNameLabel }}</span>
        </span>

        <!-- Scope 标签：自动反映当前写入目标（编辑的文档目录 / 工作区根） -->
        <span
          class="scope-label"
          :title="resolvedTerminalContext.scope === 'document'
            ? '写入受限到当前文档目录；读取仍是整个工作区'
            : '写入工作区根；读取整个工作区'"
        >
          {{ scopeLabel }}
        </span>

        <!-- UI / TUI 切换 -->
        <div class="mode-toggle">
          <button
            class="mode-btn"
            :class="{ 'mode-btn--active': currentMode === 'ui' }"
            @click="switchMode('ui')"
          >UI</button>
          <button
            class="mode-btn"
            :class="{ 'mode-btn--active': currentMode === 'tui' }"
            @click="switchMode('tui')"
          >TUI</button>
        </div>

        <!-- 状态点（颜色 + tooltip 显示完整状态/错误） -->
        <span
          class="status-dot"
          :class="{
            'status-dot--idle': status === 'idle' || status === 'spawning',
            'status-dot--ok': status === 'ok',
            'status-dot--err': status === 'error'
          }"
          :title="status === 'ok'
            ? 'Claude 已就绪'
            : status === 'spawning' ? '启动中…'
            : status === 'error' ? errorMsg
            : '准备中…'"
        />

        <span class="ml-auto" />
        <button
          v-if="canCloseManualPanel"
          class="terminal-close-btn"
          title="收起 AI 对话"
          @click="uiStore.closeTerminalPanel"
        >×</button>
      </template>

      <span v-else class="text-xxs text-muted-foreground/70">未打开项目</span>
    </div>

    <!-- 内容区：TUI / UI 模式切换 -->
    <div class="relative flex-1 min-h-0">
      <!-- TUI: xterm -->
      <div
        v-show="currentMode === 'tui'"
        ref="xtermContainer"
        class="absolute inset-0 px-2 py-2"
      />

      <!-- UI: ConversationView -->
      <div v-if="currentMode === 'ui'" class="absolute inset-0">
        <ConversationView
          :key="activeAiProjectKey"
          :claude-status="status"
          :claude-error="errorMsg"
          :target-document="conversationTargetDocument"
          :target-workspace="conversationTargetWorkspace"
          :draft-key="activeAiProjectKey"
          :initial-draft="uiStore.pendingConversationDraft"
          @abort-turn="abortUiTurn"
          @new-session="newUiSession"
          @force-reset="forceResetClaudeUi"
          @prepare-submit-session="prepareSubmitSession"
        />
      </div>

      <!-- 没项目时的引导 -->
      <div
        v-if="!hasProject"
        class="absolute inset-0 flex items-center justify-center bg-card text-center px-6"
      >
        <div>
          <div class="text-3xl mb-3">💻</div>
          <div class="text-sm text-foreground mb-1">还没打开项目</div>
          <div class="text-xs text-muted-foreground/70 leading-relaxed">
            Claude Code 会在你打开或新增项目后<br />
            以项目根启动，并遵守当前编辑范围规则
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
:deep(.xterm) { height: 100%; }
:deep(.xterm-viewport)::-webkit-scrollbar { width: 8px; }
:deep(.xterm-viewport)::-webkit-scrollbar-thumb { background: #3a3a3c; border-radius: 4px; }

.terminal-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 8;
  width: 1px;
  pointer-events: none;
  background: rgba(148, 163, 184, 0.35);
}

.terminal-resize-handle {
  position: absolute;
  top: 8px;
  left: 0;
  z-index: 11;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 28px;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  background: var(--color-bg-panel, #fff);
  color: var(--color-text-tertiary, #94a3b8);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
  transform: translateX(-50%);
  /* 外层框只作视觉提示，鼠标穿透；真正的拖动 hit-area 是内部 grip span。
     鼠标离开 grip 视觉立即不再有 col-resize 光标、不能 mousedown 启动 drag。 */
  pointer-events: none;
  cursor: default;
}

/* hover / 拖动中视觉提示用 :has 上抬到外层框 */
.terminal-resize-handle:has(.terminal-resize-grip:hover),
.terminal-resize-handle:has(.terminal-resize-grip:active) {
  border-color: rgba(37, 99, 235, 0.35);
  color: var(--color-accent, #2563eb);
}

.terminal-resize-grip {
  width: 6px;
  height: 14px;
  border-left: 2px solid currentColor;
  border-right: 2px solid currentColor;
  /* 唯一的拖动 hit-area：跟视觉精确一致 */
  pointer-events: auto;
  cursor: col-resize;
}

.mode-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 4px;
  overflow: hidden;
}
.mode-btn {
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary, #94a3b8);
  cursor: pointer;
  transition: all 0.15s;
}
.mode-btn--active {
  background: var(--color-accent, #2563eb);
  color: #fff;
}
.mode-btn:hover:not(.mode-btn--active) {
  background: var(--color-bg-secondary, #f1f5f9);
}
.scope-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  background: var(--color-bg-base, #f8fafc);
  color: var(--color-text-secondary, #475569);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-context-label {
  display: inline-flex;
  min-width: 0;
  max-width: 150px;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 650;
  color: var(--color-text-primary, #0f172a);
}
.project-context-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: var(--color-accent, #2563eb);
}
.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot--idle { background: #cbd5e1; }
.status-dot--ok   { background: #22c55e; }
.status-dot--err  { background: #ef4444; }
.terminal-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary, #94a3b8);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.terminal-close-btn:hover {
  background: var(--color-bg-secondary, #f1f5f9);
  color: var(--color-text-primary, #0f172a);
}
</style>
