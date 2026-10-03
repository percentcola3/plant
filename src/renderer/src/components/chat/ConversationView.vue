<script setup lang="ts">
// ConversationView — 对话流主视图
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import PlantIllustration from '@/components/brand/PlantIllustration.vue'
import { Plus } from 'lucide-vue-next'
import { useConversationStore } from '@/stores/conversation'
import MessageContent from './MessageContent.vue'
import MessageActions from './MessageActions.vue'
import ChatComposer from './ChatComposer.vue'
import ProcessTimeline from './ProcessTimeline.vue'
import { call } from '@/lib/api'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import {
  buildApprovalContinuationPrompt,
  buildTurnStatusNotice
} from '@/lib/chat/display-state'
import { findConclusionUuids, collectProcessTexts } from '@/lib/chat/narration'
import { extractToolCallPairs, groupToolCalls, type ToolGroupEntry } from '@/lib/chat/tool-groups'
import { parseClaudeInteraction } from '@shared/claude-interactions'
import { useTurnTicker, formatElapsed } from '@/lib/chat/turn-ticker'
import { hasPendingClaudeInteraction } from '@/lib/chat/pending-interactions'
import type { AgentContentBlock, AgentMessage, AgentRole } from '@/lib/chat/agent-events'
import { DEFAULT_CLI_KIND, type CliKind } from '@shared/cli'
import { DEFAULT_AI_PROVIDER, type AiProvider } from '@shared/ai-provider'

type ClaudeStatus = 'idle' | 'spawning' | 'ok' | 'error'
type TargetDocument = {
  relPath: string
  kind: 'markdown' | 'css' | 'html' | 'text'
  readonly?: boolean
}
type TargetWorkspace = { kind: 'workspace-home'; scopeKey?: string; intent?: 'design-prd' }
type AiPanelSettings = { cliKind?: CliKind; aiProvider?: AiProvider }
type AssistantIdentity = { name: 'Claude' | 'Plant' | 'Codex' | 'OpenCode' | 'Pi'; avatar: 'C' | 'P' | 'O' | 'π' }

const props = withDefaults(defineProps<{
  claudeStatus?: ClaudeStatus
  claudeError?: string
  targetDocument?: TargetDocument | null
  targetWorkspace?: TargetWorkspace | null
  draftKey?: string
  initialDraft?: { id: number; text: string } | null
}>(), {
  claudeStatus: 'idle',
  claudeError: '',
  draftKey: 'workspace'
})

const emit = defineEmits<{
  abortTurn: []
  newSession: []
  forceReset: []
  prepareSubmitSession: [request: PrepareSubmitSessionRequest]
}>()

const conversationStore = useConversationStore()
const projectsStore = useWorkspacesStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

const scrollContainer = ref<HTMLDivElement>()
const composerRef = ref<InstanceType<typeof ChatComposer>>()
const shouldStickToBottom = ref(true)
const diagnosticsExporting = ref(false)
const SCROLL_BOTTOM_THRESHOLD = 96
const assistantIdentity = ref<AssistantIdentity>({ name: 'Claude', avatar: 'C' })

function assistantIdentityFromSettings(settings: AiPanelSettings): AssistantIdentity {
  if (settings.aiProvider === 'deepseek-harness') return { name: 'Plant', avatar: 'P' }
  if (settings.aiProvider === 'codex-cli') return { name: 'Codex', avatar: 'C' }
  if (settings.aiProvider === 'opencode-cli') return { name: 'OpenCode', avatar: 'O' }
  if (settings.aiProvider === 'pi-cli') return { name: 'Pi', avatar: 'π' }
  return { name: 'Claude', avatar: 'C' }
}

async function loadAssistantIdentity(): Promise<void> {
  const result = await call('settings.get', undefined)
  if (result.ok) assistantIdentity.value = assistantIdentityFromSettings({
    cliKind: result.data.cliKind ?? DEFAULT_CLI_KIND,
    aiProvider: result.data.aiProvider ?? DEFAULT_AI_PROVIDER,
  })
}

function onAiEngineChanged(event: Event): void {
  const settings = (event as CustomEvent<AiPanelSettings>).detail
  if (settings) assistantIdentity.value = assistantIdentityFromSettings(settings)
}

// 监听 inspector 的 chip 注入事件
function onHostInsertChip(e: Event) {
  const detail = (e as CustomEvent).detail as { alias: string; path: string }
  if (detail.alias && detail.path) {
    composerRef.value?.insertChipFromInspector(detail)
  }
}

function onHostPicksSync(e: Event) {
  const detail = (e as CustomEvent).detail as { paths?: string[] }
  if (Array.isArray(detail.paths)) {
    composerRef.value?.syncChipsWithInspector(detail.paths)
  }
}

onMounted(() => {
  void loadAssistantIdentity()
  window.addEventListener('__uikit_host_insert_chip__', onHostInsertChip)
  window.addEventListener('__uikit_host_picks_sync__', onHostPicksSync)
  window.addEventListener('ai-engine-changed', onAiEngineChanged)
  window.addEventListener('keydown', onWindowKeydown)
  // TerminalPane 用 v-if 切换 UI / TUI，每次切回 UI 都会重新挂载 ConversationView，
  // 默认 scrollTop=0 会停在顶部。挂载后立即定位到底部，保证回切看到最新消息。
  nextTick(() => scrollMessagesToBottom({ force: true }))
})
onBeforeUnmount(() => {
  window.removeEventListener('__uikit_host_insert_chip__', onHostInsertChip)
  window.removeEventListener('__uikit_host_picks_sync__', onHostPicksSync)
  window.removeEventListener('ai-engine-changed', onAiEngineChanged)
  window.removeEventListener('keydown', onWindowKeydown)
})

const messages = computed(() => conversationStore.messages)
// initialDraft 填入后待发送的文本；等 claudeStatus='ok' 后由下方 watcher 自动发出。
const pendingAutoSubmitText = ref<string | null>(null)
type MessageGroup = {
  key: string
  role: AgentRole
  messages: AgentMessage[]
}

// Claude 一个回合可能拆成多条 assistant message（工具调用、工具结果、最终正文）。
// 连续 assistant 消息合成一个视觉回复组，避免每个工具步骤都重复头像和操作栏。
const messageGroups = computed<MessageGroup[]>(() => {
  const groups: MessageGroup[] = []
  for (const message of messages.value) {
    const previous = groups.at(-1)
    if (message.role === 'assistant' && previous?.role === 'assistant') {
      previous.messages.push(message)
      continue
    }
    groups.push({ key: message.uuid, role: message.role, messages: [message] })
  }
  return groups
})
const sessionId = computed(() => conversationStore.activeSessionId)

// 部分链路下模型推理常以普通 text block 输出（thinking block 反而是空的）。
// 规则：每个 assistant 组内最后一条带非空 text 的消息是「结论」，正常渲染；
// 其余消息里的 text 都是过程旁白，按折叠块展示，任务结束后只突出最终结论。
const conclusionUuids = computed(() => findConclusionUuids(messageGroups.value))

function isProcessNarration(message: AgentMessage): boolean {
  return message.role === 'assistant' && !conclusionUuids.value.has(message.uuid)
}

// 流式 assistant 会拆出多条 message，其中大部分内容都被 ProcessTimeline 收纳。
// 判断这条 assistant 消息在 msg-segment 里是否有可渲染内容——纯过程旁白 + 无工具
// 交互卡 = 空壳。suppress-process=true / hide-tool-calls=true 会让 MessageContent
// 内所有 block 都跳过；对应 msg-loading（要求 !isProcessNarration）也被跳过，剩下就是
// 空 div。空 div 靠 `+ .msg-segment` 的 margin/padding/border 累加会顶出大片空白，
// 直接不渲染。
function messageRendersEmpty(message: AgentMessage): boolean {
  if (message.role !== 'assistant') return false
  if (message.abortedAt) return false         // 会显示"已中止"
  if (!isProcessNarration(message)) return false // 结论消息有正文
  if (hasPendingClaudeInteraction(message.content)) return false // 交互卡自己占位
  const hasInteractionToolUse = message.content.some(block =>
    block.type === 'tool_use' && parseClaudeInteraction(block.name, block.input) !== null
  )
  return !hasInteractionToolUse
}

// 组内全部过程文本（thinking + 旁白 text），按时间顺序合并成一个折叠块，
// 避免 N 轮思考各占一行。结论正文与工具卡片不受影响。
function processTextsOf(group: MessageGroup): string[] {
  if (group.role !== 'assistant') return []
  return collectProcessTexts(group.messages, conclusionUuids.value)
}

// 组内还有旁白在流式输出时，时间线思考胶囊显示"思考中"
function groupProcessStreaming(group: MessageGroup): boolean {
  return group.messages.some(message => message.inFlight && isProcessNarration(message))
}

// 组内非交互类工具调用（跨消息按 toolUseId 配对后分组），进时间线节点。
// 交互问答（AskUserQuestion 等）走 ClaudeInteractionCard，不进时间线。
function processToolEntries(group: MessageGroup): ToolGroupEntry[] {
  if (group.role !== 'assistant') return []
  const contents = group.messages.flatMap(message => message.content)
  const pairs = extractToolCallPairs(contents)
    .filter(pair => !parseClaudeInteraction(pair.name, pair.input))
  return groupToolCalls(pairs)
}

// 组级过程时间线的展开状态：思考收敛为一个胶囊，工具节点收起时隐藏。
// 任务运行中工具节点保持可见（实时进度），结束后自动收起。
const expandedProcessGroups = ref(new Set<string>())
function toggleProcessGroup(key: string): void {
  const next = new Set(expandedProcessGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedProcessGroups.value = next
}
const turnState = computed(() => conversationStore.activeTurnState)
const turnInFlight = computed(() => conversationStore.currentTurnInFlight)
const approvalRequest = computed(() => {
  const request = turnState.value.approvalRequest
  if (!request) return null
  return {
    ...request,
    approvalPrompt: buildApprovalContinuationPrompt(request.command)
  }
})
const canApprove = computed(() => {
  if (!approvalRequest.value) return false
  if (props.claudeStatus !== 'ok') return false
  return !turnInFlight.value || turnState.value.status === 'waitingApproval'
})
const turnStatusNotice = computed(() => buildTurnStatusNotice(
  messages.value,
  conversationStore.currentTurnInFlight,
  turnState.value
))
const { elapsedSeconds } = useTurnTicker(turnInFlight)
const elapsedText = computed(() => formatElapsed(elapsedSeconds.value))

// 全局 ESC：进行中且焦点不在输入控件时，中止 turn
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (!turnInFlight.value) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  emit('abortTurn')
}

// 占位 loading 气泡：正在等首个 assistant token，或 token 到了但中间穿插 tool_use 还没下一段文本时
// 条件：turn in-flight && 最后一条不是当前还在流式输出的 assistant
const showPendingBubble = computed(() => {
  if (!conversationStore.currentTurnInFlight) return false
  if (turnState.value.status === 'waitingApproval') return false
  const last = messages.value[messages.value.length - 1]
  if (!last) return true
  return !(last.role === 'assistant' && last.inFlight)
})

type SubmitPayload = {
  text: string
  displayText?: string
  chips: Array<{
    alias: string
    path: string
    tagName?: string
    textPreview?: string
    edits?: Record<string, string>
  }>
  images: Array<{ mediaType: string; data: string }>
  editableArea?: { relPath: string; kind: 'ui-product' | 'ui-component' }
  allowedTools?: string[]
  targetDocument?: TargetDocument
  targetWorkspace?: TargetWorkspace
}
type SubmitResult = {
  sessionId: string
  workspaceId: string
  taskId: string
  turnPid: number
}
type PrepareSubmitSessionRequest = {
  targetDocument?: TargetDocument
  targetWorkspace?: TargetWorkspace
  resolve: (sessionId: string) => void
  reject: (message: string) => void
}

function isNearMessageBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD
}

function onMessagesScroll(): void {
  const el = scrollContainer.value
  if (!el) return
  shouldStickToBottom.value = isNearMessageBottom(el)
}

function scrollMessagesToBottom(options: { force?: boolean } = {}): void {
  const el = scrollContainer.value
  if (!el) return
  if (options.force) {
    el.scrollTop = el.scrollHeight
    shouldStickToBottom.value = true
    return
  }
  if (!shouldStickToBottom.value) return
  el.scrollTop = el.scrollHeight
  shouldStickToBottom.value = true
}

// 只有用户停在底部附近时，才随新输出继续跟随底部。
watch(messages, () => {
  nextTick(() => scrollMessagesToBottom())
}, { deep: true })

function messageHasPendingInteraction(msg: { role: string; inFlight: boolean; content: AgentContentBlock[] }): boolean {
  return msg.role === 'assistant' && !msg.inFlight && hasPendingClaudeInteraction(msg.content)
}

// 提交消息
async function onSubmit(payload: SubmitPayload) {
  const workspaceId = projectsStore.activeId
  if (!workspaceId) return

  // displayText 用于用户气泡展示（含 @alias / @relPath 字面，不含 prefix）
  const { displayText, ...submitPayload } = payload
  const targetDocument = payload.targetDocument !== undefined
    ? payload.targetDocument
    : configuredTargetDocument()
  const targetWorkspace = payload.targetWorkspace !== undefined
    ? payload.targetWorkspace
    : configuredTargetWorkspace()
  let sid: string | null = null

  try {
    sid = await prepareSubmitSession(targetDocument, targetWorkspace)
    // 把 chips 一起喂给 store，用户回头点 resend 时还能拼回 selector 上下文（A4）。
    // images 也传进去，让 optimistic 用户气泡立即显示拖拽 / 粘贴的图。
    conversationStore.beginTurn(sid, displayText ?? payload.text, payload.chips, payload.images)
    const r = await call('claude.submit', { workspaceId, sessionId: sid, ...submitPayload, targetDocument, targetWorkspace })
    if (!r.ok) {
      console.error('[ConversationView] submit failed:', r.message)
      reportSubmitFailure(sid, r.message)
    } else {
      await activateSubmittedTaskWorkspace(workspaceId, r.data)
    }
  } catch (error) {
    const message = messageFromUnknown(error)
    console.error('[ConversationView] submit threw:', error)
    if (sid) reportSubmitFailure(sid, message)
    else uiStore.showToast('error', `AI 提交失败：${message}`, 6000)
  }
}

watch(() => props.initialDraft, async (draft) => {
  if (!draft?.text.trim()) return
  await nextTick()
  if (!composerRef.value) return
  composerRef.value.replaceTextDraft(draft.text)
  pendingAutoSubmitText.value = draft.text
  uiStore.consumeConversationDraft(draft.id)
}, { immediate: true, flush: 'post' })

// 首页「开始构建」带进来的指令不止要填入输入框，还要直接触发对话。
// 等 Claude 会话就绪（claudeStatus='ok'，TerminalPane 挂载期 initUiMode 跑完）再发：
// ConversationView 挂载时会话还在初始化，立刻发会和它并发争抢 activeSession。
// 一直没就绪（CLI 未装 / 初始化失败）就保持填入不发送，用户修好环境后手动发。
watch(() => [props.claudeStatus === 'ok', pendingAutoSubmitText.value] as const, async ([ready, text]) => {
  if (!ready || !text) return
  pendingAutoSubmitText.value = null
  if (conversationStore.currentTurnInFlight) return
  await nextTick()
  composerRef.value?.submitDraft()
})

async function onSubmitInteraction(payload: { toolUseId: string; text: string }) {
  if (props.claudeStatus !== 'ok') return
  const workspaceId = projectsStore.activeId
  if (!workspaceId || !payload.text.trim()) return

  const sid = sessionId.value ?? ''
  if (!sid) {
    uiStore.showToast('error', 'AI 会话不存在，请重新发送消息', 6000)
    return
  }
  conversationStore.beginTurn(sid, payload.text)

  try {
    const r = await call('claude.submit', {
      workspaceId,
      sessionId: sid,
      text: payload.text,
      targetDocument: configuredTargetDocument(),
      targetWorkspace: configuredTargetWorkspace(),
      toolResult: {
        toolUseId: payload.toolUseId,
        content: payload.text
      }
    })
    if (!r.ok) {
      console.error('[ConversationView] interaction submit failed:', r.message)
      reportSubmitFailure(sid, r.message)
    } else {
      await activateSubmittedTaskWorkspace(workspaceId, r.data)
    }
  } catch (error) {
    const message = messageFromUnknown(error)
    console.error('[ConversationView] interaction submit threw:', error)
    reportSubmitFailure(sid, message)
  }
}

async function approveLatestRequest(): Promise<void> {
  const request = approvalRequest.value
  const workspaceId = projectsStore.activeId
  const sid = sessionId.value ?? ''
  if (!request || !workspaceId || !canApprove.value) return
  if (!sid) {
    uiStore.showToast('error', 'AI 会话不存在，请重新发送消息', 6000)
    return
  }

  conversationStore.beginInternalTurn(sid)
  try {
    const r = await call('claude.submit', {
      workspaceId,
      sessionId: sid,
      text: request.approvalPrompt,
      chips: [],
      images: [],
      targetDocument: configuredTargetDocument(),
      targetWorkspace: configuredTargetWorkspace(),
      allowedTools: request.allowedTools
    })
    if (!r.ok) {
      console.error('[ConversationView] approval submit failed:', r.message)
      reportSubmitFailure(sid, r.message)
    } else {
      await activateSubmittedTaskWorkspace(workspaceId, r.data)
    }
  } catch (error) {
    const message = messageFromUnknown(error)
    console.error('[ConversationView] approval submit threw:', error)
    reportSubmitFailure(sid, message)
  }
}

// 新模型：AI 任务不再新建 worktree/hidden workspace，就在当前 workspace 里跑。
// 提交后不切工作区，只把 activeSession 指向新 session 让 ConversationView 继续渲染。
async function activateSubmittedTaskWorkspace(_currentWorkspaceId: string, result: SubmitResult): Promise<void> {
  conversationStore.setActiveSession(result.sessionId)
}

function prepareSubmitSession(
  targetDocument: TargetDocument | undefined,
  targetWorkspace: TargetWorkspace | undefined
): Promise<string> {
  return new Promise((resolve, reject) => {
    emit('prepareSubmitSession', {
      targetDocument,
      targetWorkspace,
      resolve,
      reject: (message) => reject(new Error(message))
    })
  })
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function reportSubmitFailure(sessionId: string, message: string): void {
  const display = `AI 提交失败：${message}`
  // 清掉 beginTurn 留下的 temp_ 用户气泡，避免错误后留孤儿（A5）
  conversationStore.removeOptimisticMessages(sessionId)
  conversationStore.endTurn(sessionId, 'error', [], message)
  uiStore.showToast('error', display, 6000)
}

async function exportFailureDiagnostics(): Promise<void> {
  if (diagnosticsExporting.value) return
  diagnosticsExporting.value = true
  const r = await call('diagnostics.export', { sessionId: sessionId.value ?? undefined })
  diagnosticsExporting.value = false
  if (r.ok) uiStore.showToast('success', '诊断日志已导出并在 Finder 中定位')
  else uiStore.showToast('error', `导出诊断日志失败：${r.message}`, 5000)
}

// 角色样式
function roleClass(role: AgentRole): string {
  return role === 'user' ? 'msg-group--user' : role === 'assistant' ? 'msg-group--assistant' : 'msg-group--system'
}

function groupHasPendingInteraction(group: MessageGroup): boolean {
  return group.messages.some(messageHasPendingInteraction)
}

function groupInFlight(group: MessageGroup): boolean {
  return group.messages.some(message => message.inFlight)
}

function messageHasActionableText(message: AgentMessage): boolean {
  return message.content.some(block => block.type === 'text' && block.text.trim().length > 0)
}

function currentTargetDocument(): SubmitPayload['targetDocument'] | undefined {
  const session = editorStore.session
  if (!session || session.projectId !== projectsStore.activeId || session.readonly) return undefined
  return {
    relPath: session.relPath,
    kind: session.kind,
    readonly: session.readonly
  }
}

function configuredTargetDocument(): TargetDocument | undefined {
  if (props.targetDocument !== undefined) {
    return props.targetDocument ?? undefined
  }
  return currentTargetDocument()
}

function configuredTargetWorkspace(): TargetWorkspace | undefined {
  if (props.targetWorkspace !== undefined) {
    return props.targetWorkspace ?? undefined
  }
  return undefined
}
</script>

<template>
  <div class="conversation-view">
    <div class="cv-status">
      <span class="cv-status-right">
        <span v-if="turnInFlight" class="cv-elapsed">{{ elapsedText }}</span>
        <button
          v-if="turnInFlight"
          type="button"
          class="cv-stop"
          title="中止当前回合（ESC）"
          aria-label="中止当前回合"
          @click="emit('abortTurn')"
        >
          <span class="cv-stop-icon" />
          <span>STOP</span>
          <kbd class="cv-stop-kbd">ESC</kbd>
        </button>
        <button
          type="button"
          class="cv-new-session"
          title="新建对话"
          aria-label="新建对话"
          @click="emit('newSession')"
        >
          <Plus :size="17" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </span>
    </div>
    <div ref="scrollContainer" class="cv-messages" @scroll="onMessagesScroll">
      <div v-if="messages.length === 0" class="cv-empty">
        <PlantIllustration kind="skills" class="cv-empty__illustration" />
        <strong>告诉我你想完成什么</strong>
        <span class="cv-empty__description">描述目标，或添加图片和截图作为参考</span>
      </div>
      <section
        v-for="group in messageGroups"
        :key="group.key"
        class="msg-group"
        :class="roleClass(group.role)"
      >
        <template v-if="group.role === 'system'">
          <div class="msg-system-line" />
          <div class="msg-system-content">
            <MessageContent
              v-for="msg in group.messages"
              :key="msg.uuid"
              :content="msg.content"
              :session-id="sessionId ?? ''"
            />
          </div>
          <div class="msg-system-line" />
        </template>

        <template v-else>
          <div class="msg-avatar">
            <span v-if="group.role === 'user'" class="avatar avatar--user">你</span>
            <span v-else class="avatar avatar--assistant">{{ assistantIdentity.avatar }}</span>
          </div>
          <div class="msg-body">
            <div v-if="group.role === 'assistant'" class="msg-group-head">
              <span class="msg-speaker">{{ assistantIdentity.name }}</span>
              <span
                v-if="groupHasPendingInteraction(group)"
                class="msg-processed msg-processed--waiting"
              >等待你提交</span>
              <span
                v-else-if="groupInFlight(group)"
                class="msg-processed msg-processed--running"
              >处理中</span>
              <span v-else class="msg-processed">已处理</span>
            </div>

            <!-- 组内过程时间线：思考收敛为一个胶囊，工具调用是轨道上的单行节点，
                 任务结束后整段收起，只突出最终结论（ZCode 风格） -->
            <ProcessTimeline
              v-if="group.role === 'assistant'
                && (processTextsOf(group).length > 0 || processToolEntries(group).length > 0)"
              :thinking-texts="processTextsOf(group)"
              :thinking-streaming="groupProcessStreaming(group)"
              :tool-entries="processToolEntries(group)"
              :running="groupInFlight(group)"
              :expanded="expandedProcessGroups.has(group.key)"
              @toggle="toggleProcessGroup(group.key)"
            />

            <template v-for="msg in group.messages" :key="msg.uuid">
              <div v-if="!messageRendersEmpty(msg)" class="msg-segment">
                <MessageContent
                  :content="msg.content"
                  :session-id="sessionId ?? ''"
                  :interaction-disabled="props.claudeStatus !== 'ok' || conversationStore.currentTurnInFlight"
                  :streaming="msg.inFlight"
                  :process-text="isProcessNarration(msg)"
                  :suppress-process="group.role === 'assistant'"
                  :hide-tool-calls="group.role === 'assistant'"
                  @submit-interaction="onSubmitInteraction"
                />
                <div v-if="msg.inFlight && !isProcessNarration(msg)" class="msg-loading">
                  <span class="thinking-loader">
                    <span class="thinking-dot" /><span class="thinking-dot" /><span class="thinking-dot" />
                    <span class="thinking-text">{{ assistantIdentity.name }} 正在整理回复</span>
                  </span>
                </div>
                <div v-if="msg.abortedAt" class="msg-aborted">已中止</div>
                <MessageActions
                  v-if="!msg.inFlight && !isProcessNarration(msg) && !messageHasPendingInteraction(msg) && messageHasActionableText(msg)"
                  :content="msg.content"
                />
              </div>
            </template>
          </div>
        </template>
      </section>

      <!-- 占位 loading 气泡：等待首个 assistant token 时显示 -->
      <section v-if="showPendingBubble" class="msg-group msg-group--assistant">
        <div class="msg-avatar">
          <span class="avatar avatar--assistant">{{ assistantIdentity.avatar }}</span>
        </div>
        <div class="msg-body">
          <div class="msg-group-head">
            <span class="msg-speaker">{{ assistantIdentity.name }}</span>
            <span class="msg-processed msg-processed--running">处理中</span>
          </div>
          <div class="msg-loading">
            <span class="thinking-loader">
              <span class="thinking-dot" /><span class="thinking-dot" /><span class="thinking-dot" />
              <span class="thinking-text">等待 {{ assistantIdentity.name }} 响应</span>
            </span>
          </div>
        </div>
      </section>
      <div
        v-if="turnStatusNotice"
        class="cv-turn-notice"
        :class="`cv-turn-notice--${turnStatusNotice.tone}`"
      >
        <div class="cv-turn-notice-header">
          <div class="cv-turn-notice-title">{{ turnStatusNotice.title }}</div>
          <button
            v-if="turnState.status === 'error'"
            type="button"
            class="cv-turn-notice-action"
            :disabled="diagnosticsExporting"
            @click="exportFailureDiagnostics"
          >{{ diagnosticsExporting ? '导出中…' : '导出诊断日志' }}</button>
        </div>
        <div class="cv-turn-notice-detail" :title="turnStatusNotice.detail">{{ turnStatusNotice.detail }}</div>
      </div>
    </div>
    <div v-if="approvalRequest" class="cv-approval-banner">
      <div class="cv-approval-header">
        <div class="cv-approval-title">需要人工授权</div>
        <div class="cv-approval-actions">
          <button
            type="button"
            class="cv-approval-btn cv-approval-btn--primary"
            :disabled="!canApprove"
            title="在 UI 模式中授权本次 Bash 执行并继续"
            @click="approveLatestRequest"
          >授权并继续</button>
        </div>
      </div>
      <div class="cv-approval-command" :title="approvalRequest.command">{{ approvalRequest.command }}</div>
      <div class="cv-approval-hint">{{ approvalRequest.hint }}</div>
    </div>
    <ChatComposer
      ref="composerRef"
      :draft-key="draftKey"
      @submit="onSubmit"
      @abort-turn="emit('abortTurn')"
      @new-session="emit('newSession')"
      @force-reset="emit('forceReset')"
    />
  </div>
</template>

<style scoped>
.conversation-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-panel, #fff);
}
.cv-status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-height: 30px;
  padding: 6px 12px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.cv-turn-notice-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cv-turn-notice-action {
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  padding: 4px 8px;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}
.cv-turn-notice-action:disabled { cursor: wait; opacity: 0.6; }
.cv-status-right { display: inline-flex; align-items: center; gap: 8px; }
.cv-elapsed {
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border-radius: 6px; padding: 3px 6px; line-height: 1;
}
.cv-stop {
  display: inline-flex; align-items: center; gap: 5px;
  border: 0;
  background: var(--color-error-subtle); color: var(--color-error);
  font-size: 11px; font-weight: 700; line-height: 1;
  padding: 4px 9px 4px 8px; cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.cv-stop:hover { background: var(--color-error); color: #fff; }
.cv-stop-icon {
  width: 8px; height: 8px; background: currentColor; border-radius: 1px;
}
.cv-stop-kbd {
  font-family: 'SF Mono', Menlo, monospace; font-size: 9px; font-weight: 600;
  background: rgba(0,0,0,0.08); border-radius: 3px;
  padding: 1px 4px; color: inherit; letter-spacing: 0.04em;
}
.cv-stop:hover .cv-stop-kbd { background: rgba(255,255,255,0.22); }
.cv-new-session {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.cv-new-session:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.cv-new-session:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-info-subtle);
}
.cv-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 16px;
  background: transparent;
}
.cv-approval-banner {
  margin: 0 12px 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: var(--color-warning-subtle);
  color: var(--color-warning);
  font-size: 12px;
}
.cv-approval-title {
  font-weight: 600;
}
.cv-approval-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.cv-approval-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.cv-approval-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
}
.cv-approval-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}
.cv-approval-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.cv-approval-btn--primary {
  background: var(--color-warning);
  border-color: var(--color-warning);
  color: #fff;
  font-weight: 600;
}
.cv-approval-btn--primary:hover:not(:disabled) {
  background: var(--color-warning);
  border-color: var(--color-warning);
}
.cv-approval-command {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 6px;
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  padding: 5px 7px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.cv-approval-hint {
  margin-top: 5px;
  line-height: 1.5;
}
.cv-turn-notice {
  margin: 4px 0 12px 40px;
  max-width: 78%;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: var(--color-bg-panel);
  color: var(--color-text-secondary);
  padding: 9px 12px;
  font-size: 12px;
  line-height: 1.5;
}
.cv-turn-notice--running {
  border-color: transparent;
  background: var(--color-accent-light);
  color: var(--color-accent-pressed);
}
.cv-turn-notice--warning {
  border-color: transparent;
  background: var(--color-warning-subtle);
  color: var(--color-text-primary);
}
.cv-turn-notice--success {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 4px 40px;
  max-width: calc(100% - 40px);
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 2px 0;
  font-size: 11px;
  color: var(--color-success);
}
.cv-turn-notice--success .cv-turn-notice-header {
  flex: 0 0 auto;
}
.cv-turn-notice--success .cv-turn-notice-title {
  font-weight: 500;
}
.cv-turn-notice--success .cv-turn-notice-detail {
  min-width: 0;
  margin-top: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
}
.cv-turn-notice-title {
  font-weight: 700;
}
.cv-turn-notice-detail {
  margin-top: 3px;
}
.cv-empty {
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 100%;
  padding: 32px;
  text-align: center;
  color: var(--color-text-muted);
}
.cv-empty__illustration {
  margin-bottom: 10px;
}
.cv-empty strong {
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 650;
  line-height: 1.35;
}
.cv-empty__description {
  color: var(--color-text-primary);
  font-size: 12px;
  line-height: 1.5;
}
.msg-group {
  display: flex;
  gap: 10px;
  margin: 10px 0;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: var(--color-bg-panel);
  position: relative;
}
.cv-messages > .msg-group:first-of-type {
  margin-top: 0;
}
.msg-group--user {
  flex-direction: row-reverse;
  margin-left: 44px;
  border-color: transparent;
  background: var(--color-accent-light);
}
.msg-group--user .msg-body { align-items: flex-end; }
.msg-group--assistant { margin-right: 4px; }
.msg-group--system {
  align-items: center;
  gap: 10px;
  margin: 16px 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--color-text-muted);
}
.msg-system-line { height: 1px; flex: 1; background: var(--color-border-subtle); }
.msg-system-content { flex: 0 0 auto; font-size: 11px; }
.msg-avatar { flex-shrink: 0; padding-top: 2px; }
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.avatar--user {
  background: var(--color-accent-subtle);
  color: var(--color-accent-pressed);
}
.avatar--assistant {
  background: var(--color-success-subtle);
  color: var(--color-success);
}
.msg-body {
  display: flex;
  flex-direction: column;
  width: calc(100% - 40px);
  max-width: calc(100% - 42px);
  /* flex 子项默认 min-width: auto，内部 pre / 长 url 的固有宽度会撑破上面那条 max-width
     让消息往左/右溢出。必须显式 min-width: 0 才让 max-width 真正生效，pre 自身的
     overflow: auto 才能出滚动条。 */
  min-width: 0;
  position: relative;
}
.msg-group--user .msg-body {
  width: auto;
  max-width: calc(100% - 40px);
}
.msg-group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 22px;
  margin-bottom: 8px;
}
.msg-speaker {
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
}
.msg-processed {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-bg-subtle);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
}
.msg-processed--waiting {
  background: var(--color-accent-subtle);
  color: var(--color-accent-pressed);
}
.msg-processed--running {
  background: var(--color-success-subtle);
  color: var(--color-success);
}
.msg-segment {
  position: relative;
  min-width: 0;
  width: 100%;
}
.msg-segment:hover :deep(.msg-actions),
.msg-segment:focus-within :deep(.msg-actions) {
  opacity: 1;
  pointer-events: auto;
}
.msg-segment + .msg-segment {
  margin-top: 10px;
}
.msg-loading {
  margin-top: 4px;
}
.thinking-loader {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-bg-subtle);
  border-radius: 12px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.thinking-dot:nth-child(2) { animation-delay: 0.15s; }
.thinking-dot:nth-child(3) { animation-delay: 0.3s; }
.thinking-text { margin-left: 3px; }
@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.msg-aborted {
  font-size: 11px;
  color: var(--color-error);
  margin-top: 2px;
}

@media (max-width: 720px) {
  .cv-messages { padding-inline: 10px; }
  .msg-group { padding: 10px; }
  .msg-group--user { margin-left: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-dot { animation: none; }
}
</style>
