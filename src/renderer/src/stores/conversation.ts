// 对话 store：会话消息、turn 状态、alias 管理。
// Claude 原始 stdout/JSONL 事件必须先经过 normalizer，避免 provider 协议细节散落到 UI。
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AgentContentBlock,
  AgentMessage,
  AgentRole,
  AgentTurnState,
  ClaudeRawEvent,
  NormalizedAgentEvent
} from '@/lib/chat/agent-events'
import {
  applyAgentEvent,
  createInitialAgentState,
  isTurnInFlight
} from '@/lib/chat/agent-event-reducer'
import { normalizeClaudeEvent } from '@/lib/chat/claude-event-normalizer'
import { useInspectorPicksStore } from './inspector-picks'

export type Role = AgentRole
export type ContentBlock = AgentContentBlock
export type Message = AgentMessage

export const useConversationStore = defineStore('conversation', () => {
  const picksStore = useInspectorPicksStore()

  // sessionId -> messages
  const messagesBySession = ref<Map<string, Message[]>>(new Map())
  const turnStateBySession = ref<Map<string, AgentTurnState>>(new Map())
  // P2 ④ artifact 回声抑制的滑窗：sessionId -> recentFileWrites。
  // 跟 messages/turnState 一样按 session 隔离，turn 结束时清空。
  const fileWritesBySession = ref<Map<string, Array<{ toolUseId: string; content: string }>>>(new Map())

  // 活跃 session
  const activeSessionId = ref<string | null>(null)

  // alias 映射：sessionId -> (path -> alias)
  const localAliasesBySession = ref<Map<string, Map<string, string>>>(new Map())

  // 已见过的 raw event uuid 集合。stdout + JSONL 双入口会同时推同源事件，必须先去重。
  const seenUuids = ref<Map<string, Set<string>>>(new Map())

  const messages = computed<Message[]>(() => {
    if (!activeSessionId.value) return []
    return messagesBySession.value.get(activeSessionId.value) ?? []
  })

  const activeTurnState = computed<AgentTurnState>(() => {
    if (!activeSessionId.value) return createInitialAgentState().turn
    return turnStateBySession.value.get(activeSessionId.value) ?? createInitialAgentState().turn
  })

  const currentTurnInFlight = computed(() => isTurnInFlight(activeTurnState.value))

  // JSONL 全量/增量回放。保留旧方法名，内部统一走 normalizer。
  function replay(sessionId: string, events: ClaudeRawEvent[], options?: { historical?: boolean }): void {
    if (options?.historical && events.length > 0) appendHistoryDivider(sessionId)
    for (const event of events) {
      if (!markRawEventSeen(sessionId, event)) continue
      applyRawEvent(sessionId, event, { assistantInFlight: false })
    }
    if (options?.historical) clearTransientTurnState(sessionId)
  }

  // stdout 流式 push。保留旧方法名，内部统一走 normalizer。
  function appendDelta(sessionId: string, event: ClaudeRawEvent): void {
    if (!markRawEventSeen(sessionId, event)) return
    applyRawEvent(sessionId, event, { assistantInFlight: true })
  }

  function applyRawEvent(
    sessionId: string,
    event: ClaudeRawEvent,
    options: { assistantInFlight: boolean }
  ): void {
    const normalized = normalizeClaudeEvent(event, options)
    for (const item of normalized) applyNormalizedEvent(sessionId, item)
  }

  function applyNormalizedEvent(sessionId: string, event: NormalizedAgentEvent): void {
    if (event.type === 'message.user' || event.type === 'message.assistant') {
      registerPathsInBlocks(sessionId, event.content)
    }

    const state = {
      messages: getOrCreateMessages(sessionId),
      turn: getOrCreateTurnState(sessionId),
      recentFileWrites: getOrCreateFileWrites(sessionId)
    }
    applyAgentEvent(state, event)
    // reducer 可能把 recentFileWrites 赋成新空数组（turn 结束清空），
    // 同步回 session Map，保证下次读到的状态一致。
    fileWritesBySession.value.set(sessionId, state.recentFileWrites)
    messagesBySession.value = new Map(messagesBySession.value)
    turnStateBySession.value = new Map(turnStateBySession.value)
    fileWritesBySession.value = new Map(fileWritesBySession.value)
  }

  // 开始新 turn：先放一条本地临时用户气泡，之后 stdout/JSONL 的真实 user event 会替换它。
  // chipsForResend：把本次提交带的 chip 元数据挂到 optimistic 消息上，
  // 用户日后点 resend 时可以重建 chips 上下文（A4）。
  // images：粘贴 / 拖拽进输入框的图片，立即加进 optimistic 气泡，否则要等 claude 回流真 user
  // event 才显示——感觉像"图发了但消息没带图"。
  function beginTurn(
    sessionId: string,
    userText: string,
    chipsForResend?: AgentMessage['chipsForResend'],
    images?: Array<{ mediaType: string; data: string }>
  ): void {
    registerPathsInText(sessionId, userText)
    const tempUuid = `temp_${Date.now()}`
    const content: AgentContentBlock[] = [{ type: 'text', text: userText }]
    if (images) {
      for (const img of images) {
        content.push({ type: 'image', source: { mediaType: img.mediaType, data: img.data } })
      }
    }
    applyNormalizedEvent(sessionId, {
      type: 'message.user',
      uuid: tempUuid,
      content
    })
    if (chipsForResend && chipsForResend.length > 0) {
      const msgs = messagesBySession.value.get(sessionId) ?? []
      const optimistic = msgs.find(m => m.uuid === tempUuid)
      if (optimistic) {
        optimistic.chipsForResend = chipsForResend
        messagesBySession.value = new Map(messagesBySession.value)
      }
    }
    const turn = getOrCreateTurnState(sessionId)
    turn.status = 'submitting'
    turn.outcome = undefined
    turn.approvalRequest = undefined
    turn.changedArtifacts = []
    turn.errorMessage = undefined
    turnStateBySession.value = new Map(turnStateBySession.value)
  }

  function beginInternalTurn(sessionId: string): void {
    const turn = getOrCreateTurnState(sessionId)
    turn.status = 'submitting'
    turn.outcome = undefined
    turn.approvalRequest = undefined
    turn.changedArtifacts = []
    turn.errorMessage = undefined
    turnStateBySession.value = new Map(turnStateBySession.value)
  }

  // 重新打开项目时，历史 JSONL 只能重建消息，无法判断后台子进程是否仍在执行。
  // 该状态由 main 端 driver 确认后回填，避免历史回放把运行中的 turn 错置为 idle。
  function restoreRunningTurn(sessionId: string): void {
    const turn = getOrCreateTurnState(sessionId)
    turn.status = 'running'
    turn.outcome = undefined
    turn.errorMessage = undefined
    turnStateBySession.value = new Map(turnStateBySession.value)
  }

  function endTurn(sessionId: string, status: 'completed' | 'aborted' | 'error', changedArtifacts: string[] = [], errorMessage?: string): void {
    applyNormalizedEvent(sessionId, status === 'aborted'
      ? { type: 'turn.aborted' }
      : { type: 'turn.completed', status: status === 'completed' ? 'completed' : 'error', changedArtifacts, errorMessage })
  }

  function abortTurn(sessionId: string): void {
    applyNormalizedEvent(sessionId, { type: 'turn.aborted' })
  }

  // 提交失败 / 启动失败后调：把 beginTurn 注入的临时 user message 清掉，
  // 否则它永远停在历史里（uuid 一直是 temp_xxx，下一轮不会替换它）—— A5 那个 bug。
  function removeOptimisticMessages(sessionId: string): void {
    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs || msgs.length === 0) return
    const filtered = msgs.filter(m => !m.uuid.startsWith('temp_'))
    if (filtered.length === msgs.length) return
    messagesBySession.value.set(sessionId, filtered)
    messagesBySession.value = new Map(messagesBySession.value)
  }

  function clearSession(sessionId: string): void {
    messagesBySession.value.delete(sessionId)
    turnStateBySession.value.delete(sessionId)
    seenUuids.value.delete(sessionId)
    localAliasesBySession.value.delete(sessionId)
    messagesBySession.value = new Map(messagesBySession.value)
    turnStateBySession.value = new Map(turnStateBySession.value)
    seenUuids.value = new Map(seenUuids.value)
    localAliasesBySession.value = new Map(localAliasesBySession.value)
  }

  function clearAll(): void {
    messagesBySession.value = new Map()
    turnStateBySession.value = new Map()
    seenUuids.value = new Map()
    localAliasesBySession.value = new Map()
    activeSessionId.value = null
  }

  function resolveAlias(sessionId: string, path: string): { alias: string; alive: boolean } {
    const aliases = localAliasesBySession.value.get(sessionId)
    const alias = aliases?.get(path) ?? pathToAlias(path)
    const alive = picksStore.currentPicks.some(p => p.path === path)
    return { alias, alive }
  }

  function setActiveSession(sessionId: string | null): void {
    activeSessionId.value = sessionId
  }

  // -- internals -----------------------------------------------------------

  function markRawEventSeen(sessionId: string, event: ClaudeRawEvent): boolean {
    if (!event.uuid) {
      return event.type === 'result'
    }

    let seen = seenUuids.value.get(sessionId)
    if (!seen) {
      seen = new Set()
      seenUuids.value.set(sessionId, seen)
    }
    if (seen.has(event.uuid)) return false
    seen.add(event.uuid)
    seenUuids.value = new Map(seenUuids.value)
    return true
  }

  function getOrCreateMessages(sessionId: string): Message[] {
    let msgs = messagesBySession.value.get(sessionId)
    if (!msgs) {
      msgs = []
      messagesBySession.value.set(sessionId, msgs)
      messagesBySession.value = new Map(messagesBySession.value)
    }
    return msgs
  }

  function getOrCreateTurnState(sessionId: string): AgentTurnState {
    let turn = turnStateBySession.value.get(sessionId)
    if (!turn) {
      turn = createInitialAgentState().turn
      turnStateBySession.value.set(sessionId, turn)
      turnStateBySession.value = new Map(turnStateBySession.value)
    }
    return turn
  }

  // P2 ④ artifact 回声滑窗：按 session 隔离，turn 结束时由 reducer 清空（[]）
  type FileWriteRecord = { toolUseId: string; content: string }
  function getOrCreateFileWrites(sessionId: string): FileWriteRecord[] {
    let writes = fileWritesBySession.value.get(sessionId)
    if (!writes) {
      writes = []
      fileWritesBySession.value.set(sessionId, writes)
      fileWritesBySession.value = new Map(fileWritesBySession.value)
    }
    return writes
  }

  function appendHistoryDivider(sessionId: string): void {
    const msgs = getOrCreateMessages(sessionId)
    if (msgs.some(msg => msg.uuid === `history_${sessionId}`)) return
    msgs.push({
      uuid: `history_${sessionId}`,
      role: 'system',
      content: [{ type: 'text', text: '以下为上次会话历史' }],
      inFlight: false,
      createdAt: Date.now()
    })
    messagesBySession.value = new Map(messagesBySession.value)
  }

  function clearTransientTurnState(sessionId: string): void {
    const msgs = getOrCreateMessages(sessionId)
    for (const msg of msgs) msg.inFlight = false
    const turn = getOrCreateTurnState(sessionId)
    turn.status = 'idle'
    turn.outcome = undefined
    turn.approvalRequest = undefined
    turn.changedArtifacts = []
    // 历史回放结束，清空 artifact 回声滑窗（属于"当前 turn"的瞬态状态）
    fileWritesBySession.value.set(sessionId, [])
    messagesBySession.value = new Map(messagesBySession.value)
    turnStateBySession.value = new Map(turnStateBySession.value)
    fileWritesBySession.value = new Map(fileWritesBySession.value)
  }

  function registerPathsInBlocks(sessionId: string, content: ContentBlock[]): void {
    for (const block of content) {
      if (block.type === 'text') registerPathsInText(sessionId, block.text)
    }
  }

  // 简易 alias 分配：A-Z 顺序。
  let nextFallbackAliasIdx = 0
  function pathToAlias(_path: string): string {
    return String.fromCharCode(65 + (nextFallbackAliasIdx++ % 26))
  }

  // 扫描文本中的 [:path] 模式，注册到 localAliases。
  function registerPathsInText(sessionId: string, text: string): void {
    let aliases = localAliasesBySession.value.get(sessionId)
    if (!aliases) {
      aliases = new Map()
      localAliasesBySession.value.set(sessionId, aliases)
    }

    const regex = /\[:(.+?)\]/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const path = match[1]
      if (!aliases.has(path)) {
        aliases.set(path, String.fromCharCode(65 + (aliases.size % 26)))
      }
    }
    localAliasesBySession.value = new Map(localAliasesBySession.value)
  }

  return {
    messagesBySession,
    turnStateBySession,
    currentTurnInFlight,
    activeTurnState,
    activeSessionId,
    messages,
    replay,
    appendDelta,
    applyNormalizedEvent,
    beginTurn,
    beginInternalTurn,
    restoreRunningTurn,
    endTurn,
    abortTurn,
    removeOptimisticMessages,
    clearSession,
    clearAll,
    resolveAlias,
    setActiveSession
  }
})
