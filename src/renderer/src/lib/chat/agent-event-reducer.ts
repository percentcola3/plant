import { formatClaudeToolCall } from '@shared/claude-display'
import type {
  AgentApprovalRequest,
  AgentContentBlock,
  AgentMessage,
  AgentTurnState,
  NormalizedAgentEvent
} from './agent-events'
import {
  collectFileWrites,
  mergeFileWrites,
  suppressArtifactEcho
} from './artifact-echo-suppressor'

// artifact 回声抑制的滑窗状态：记录本 turn 内 file-write 工具写入的内容，
// 用于剥掉 assistant text 里重复 echo 的文件内容。turn 结束时清空。
type FileWriteRecord = { toolUseId: string; content: string }

export type AgentConversationState = {
  messages: AgentMessage[]
  turn: AgentTurnState
  // 本 turn 内的 file-write 记录（滑窗），用于 artifact 回声抑制。
  // 放 state 而非模块级变量，保证多会话/多 turn 隔离 + reducer 纯函数契约。
  recentFileWrites: FileWriteRecord[]
}

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit'])
const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate'])

export function createInitialAgentState(): AgentConversationState {
  return {
    messages: [],
    turn: { status: 'idle', changedArtifacts: [] },
    recentFileWrites: []
  }
}

export function isTurnInFlight(turn: AgentTurnState): boolean {
  return turn.status === 'submitting'
    || turn.status === 'running'
    || turn.status === 'waitingApproval'
    || turn.status === 'toolRunning'
    || turn.status === 'streaming'
}

export function applyAgentEvent(state: AgentConversationState, event: NormalizedAgentEvent): void {
  if (event.type === 'ignore') return

  if (event.type === 'message.user') {
    upsertUserMessage(state, event.uuid, event.content)
    state.turn.status = isTurnInFlight(state.turn) ? state.turn.status : 'running'
    state.turn.errorMessage = undefined
    return
  }

  if (event.type === 'message.assistant') {
    upsertAssistantMessage(state, event)
    state.turn.status = event.content.some(block => block.type === 'tool_use') ? 'toolRunning' : 'streaming'
    state.turn.approvalRequest = undefined
    return
  }

  if (event.type === 'text.delta') {
    appendTextDelta(state, event)
    return
  }

  if (event.type === 'tool.result') {
    mergeToolResults(state, event.content)
    // tool 结果回来 = 上一条 assistant 已经发完工具调用、停在等结果；关掉它的 loading，
    // 否则在 "工具结果到达 → 下一条 assistant 流出来" 之间会一直挂 "正在整理回复"。
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (msg.role !== 'assistant') continue
      if (msg.inFlight) msg.inFlight = false
      break
    }
    const approvalRequest = findLatestApprovalRequest(state.messages)
    if (approvalRequest) {
      state.turn.status = 'waitingApproval'
      state.turn.approvalRequest = approvalRequest
    } else {
      state.turn.status = 'running'
    }
    return
  }

  if (event.type === 'approval.resolved') {
    state.turn.status = 'running'
    state.turn.approvalRequest = undefined
    return
  }

  if (event.type === 'turn.completed') {
    // 一个 turn 失败时常会有两个事件入口都触发 turn.completed：
    //   1. stream-json `result` 事件（is_error=true，含具体错误内容）
    //   2. process exit 后的 turn-end IPC（errorMessage 是退出码概要）
    // 两个事件都算"已完成"信号，但只能写一次状态、加一次 system 红条，否则会
    // 出现 image 13 那种"4 次重复"。以"先到的具体错误"为准。
    // 已 aborted 的 turn 不被后续 turn.completed 覆盖（防御性兜底；正常路径下
    // main 会发 status='aborted'，不会进 turn.completed 分支）。
    if (state.turn.status === 'aborted') return
    const wasError = state.turn.status === 'error'
    for (const message of state.messages) message.inFlight = false
    state.turn.status = event.status === 'completed' ? 'completed' : 'error'
    state.turn.changedArtifacts = event.changedArtifacts ?? []
    // turn 结束清空 artifact 回声滑窗（下个 turn 的写入跟旧 turn 无关）
    state.recentFileWrites = []
    if (event.status === 'completed') {
      state.turn.errorMessage = undefined
    } else {
      // 已经记下过错误信息（多半更具体）→ 不让后续退出码概要覆盖
      state.turn.errorMessage = state.turn.errorMessage ?? event.errorMessage
    }
    // result 事件携带的最终答案落地：turn 以工具调用收尾（没有最终 assistant 文本）
    // 或文本被回声抑制剥空时，这是唯一的结论文本。与最后一条 assistant 文本相同
    // 则跳过（claude 通常会把最终文本同时以 assistant 消息发一份）。
    if (event.finalText && event.status === 'completed') {
      const lastText = lastAssistantText(state.messages)
      if (lastText.trim() !== event.finalText.trim()) {
        state.messages.push({
          uuid: `final_${event.uuid ?? Date.now()}_${state.messages.length}`,
          role: 'assistant',
          content: [{ type: 'text', text: event.finalText }],
          inFlight: false,
          createdAt: Date.now()
        })
      }
    }
    state.turn.outcome = event.status === 'completed'
      ? deriveTurnOutcome(state.messages, state.turn.changedArtifacts)
      : 'failed'
    if (event.status !== 'completed') state.turn.approvalRequest = undefined
    // 仅首次进入 error 状态时加 system 红条；且若 assistant 自己已经把错误写进
    // 最后一段 text，就别再重复一遍。
    if (event.status === 'error' && event.errorMessage && !wasError) {
      const lastText = lastAssistantText(state.messages)
      const errFirstLine = event.errorMessage.split('\n')[0].trim()
      const alreadyShown = errFirstLine.length > 0 && lastText.includes(errFirstLine)
      if (!alreadyShown) {
        state.messages.push({
          uuid: `error_${event.uuid ?? state.messages.length}_${state.messages.length}`,
          role: 'system',
          content: [{ type: 'text', text: `❌ ${event.errorMessage}` }],
          inFlight: false,
          createdAt: Date.now()
        })
      }
    }
    return
  }

  if (event.type === 'turn.aborted') {
    state.turn.status = 'aborted'
    state.turn.outcome = 'failed'
    state.turn.errorMessage = undefined
    // turn 结束清空 artifact 回声滑窗
    state.recentFileWrites = []
    const last = state.messages[state.messages.length - 1]
    if (last?.inFlight) {
      last.inFlight = false
      last.abortedAt = Date.now()
    }
  }
}

export function mergeContentBlocks(existing: AgentContentBlock[], incoming: AgentContentBlock[]): AgentContentBlock[] {
  const seen = new Set(existing.map(contentBlockKey))
  const merged = [...existing]
  for (const block of incoming) {
    const key = contentBlockKey(block)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(block)
  }
  return merged
}

export function deriveTurnOutcome(messages: AgentMessage[], changedArtifacts: string[] = []): AgentTurnState['outcome'] {
  if (changedArtifacts.length > 0) return 'wroteFiles'
  const blocks = blocksSinceLastUser(messages)
  if (blocks.length === 0) return 'noResponse'
  const toolUses = blocks.filter((block): block is Extract<AgentContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
  if (toolUses.some(block => WRITE_TOOL_NAMES.has(block.name))) return 'wroteFiles'
  if (toolUses.some(block => TASK_TOOL_NAMES.has(block.name))) return 'noWrite'
  if (toolUses.length > 0) return 'toolOnly'
  return 'responded'
}

function upsertUserMessage(state: AgentConversationState, uuid: string, content: AgentContentBlock[]): void {
  const textBlock = content.length === 1 && content[0].type === 'text' ? content[0] : null
  const optimistic = findOptimisticUserMessage(state, textBlock?.text)
  if (optimistic) {
    const existingText = optimistic.content.length === 1 && optimistic.content[0].type === 'text'
      ? optimistic.content[0].text
      : null
    optimistic.uuid = uuid
    if (textBlock && existingText === textBlock.text) optimistic.content = content
    optimistic.inFlight = false
    return
  }

  state.messages.push({
    uuid,
    role: 'user',
    content,
    inFlight: false,
    createdAt: Date.now()
  })
}

function findOptimisticUserMessage(state: AgentConversationState, incomingText?: string): AgentMessage | undefined {
  let latestOptimistic: AgentMessage | undefined
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    if (message.role !== 'user' || !message.uuid.startsWith('temp_')) continue
    const existingText = message.content.length === 1 && message.content[0].type === 'text'
      ? message.content[0].text
      : null
    if (incomingText !== undefined && existingText === incomingText) return message
    if (!latestOptimistic) latestOptimistic = message
  }
  return isTurnInFlight(state.turn) ? latestOptimistic : undefined
}

function upsertAssistantMessage(
  state: AgentConversationState,
  event: Extract<NormalizedAgentEvent, { type: 'message.assistant' }>
): void {
  // ④ artifact 回声抑制：先收集本条 message 里的 file-write 内容进滑窗，
  // 再用滑窗抑制 text blocks（剥掉跟写入内容重复的 echo）。
  // 顺序很重要：同一条 message 可能既有 Write tool_use 又有 echo text，
  // 必须先 record 再 suppress 才能命中。
  const newWrites = collectFileWrites(event.content)
  if (newWrites.length > 0) {
    state.recentFileWrites = mergeFileWrites(state.recentFileWrites, newWrites)
  }
  const suppressedContent = suppressArtifactEcho(event.content, state.recentFileWrites)

  // 查找已有 message：优先 providerMessageId 精确匹配，fallback uuid 匹配。
  // fallback 必要：text.delta 预创建的 message 可能还没 providerMessageId，
  // 后续 assistant 整消息带 providerMessageId 到达时，按 providerMessageId 查不到，
  // 需退回 uuid 查找才能合并（否则会新建第二条 message）。
  const existing = event.providerMessageId
    ? (state.messages.find(message => message.role === 'assistant' && message.providerMessageId === event.providerMessageId)
       ?? state.messages.find(message => message.role === 'assistant' && message.uuid === event.uuid))
    : state.messages.find(message => message.uuid === event.uuid)

  if (existing) {
    existing.content = existing.uuid === event.uuid
      ? suppressedContent
      : mergeContentBlocks(existing.content, suppressedContent)
    existing.inFlight = event.inFlight
    return
  }

  // 新建一条新的 assistant message：意味着上一条 assistant 已经流完（claude API 在切换
  // message 时不会再回来更新前一条）。把之前所有还在 inFlight 的 assistant 关掉，
  // 否则 turn 内每条 message 都会各自挂一个 "Claude 正在整理回复" loading。
  for (const message of state.messages) {
    if (message.role === 'assistant' && message.inFlight) message.inFlight = false
  }

  state.messages.push({
    uuid: event.uuid,
    role: 'assistant',
    content: suppressedContent,
    inFlight: event.inFlight,
    createdAt: Date.now(),
    providerMessageId: event.providerMessageId
  })
}

// P4 流式文本：把 text.delta 增量合并进目标 assistant message 的最后一个 text block。
//
// 定位策略：
//   1. 优先按 providerMessageId 精确匹配（content_block_delta 不带 message id，
//      但我们暂时没从 message_start 传过来，所以这条目前走不到，留接口给 P4.2）
//   2. 兜底：最后一条 in-flight 的 assistant message（partial-messages 下首个 delta
//      先于 assistant 整消息到达时，临时预创建一条）
//
// 预创建：若没有可归属的 message，先 push 一条 in-flight 空内容 assistant，
// 后续真正的 message.assistant 到达时 upsertAssistantMessage 会按 uuid 合并。
function appendTextDelta(
  state: AgentConversationState,
  event: Extract<NormalizedAgentEvent, { type: 'text.delta' }>
): void {
  let target = event.providerMessageId
    ? state.messages.find(m => m.role === 'assistant' && m.providerMessageId === event.providerMessageId)
    : undefined

  // 兜底：最后一条 in-flight assistant
  if (!target) {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]
      if (m.role === 'assistant' && m.inFlight) {
        target = m
        break
      }
    }
  }

  // 仍无目标 → 预创建（首个 delta 先于 assistant 整消息的时序）
  if (!target) {
    target = {
      uuid: event.uuid,
      role: 'assistant',
      content: [],
      inFlight: true,
      createdAt: Date.now(),
      providerMessageId: event.providerMessageId
    }
    state.messages.push(target)
  }

  // 追加到最后一个 text block；若末尾不是 text 则新建一个
  const lastBlock = target.content[target.content.length - 1]
  if (lastBlock && lastBlock.type === 'text') {
    lastBlock.text += event.delta
  } else {
    target.content.push({ type: 'text', text: event.delta })
  }

  // 标记正在流式输出（除非在 toolRunning 等更高优先级状态）
  if (state.turn.status !== 'toolRunning' && state.turn.status !== 'waitingApproval') {
    state.turn.status = 'streaming'
  }
}

function mergeToolResults(state: AgentConversationState, content: Extract<AgentContentBlock, { type: 'tool_result' }>[]): void {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    if (message.role !== 'assistant') continue
    message.content = mergeContentBlocks(message.content, content)
    return
  }
}

function contentBlockKey(block: AgentContentBlock): string {
  if (block.type === 'tool_use') return `tool_use:${block.toolUseId}`
  if (block.type === 'tool_result') return `tool_result:${block.toolUseId}:${block.isError === true}`
  if (block.type === 'image') return `image:${block.source.mediaType}:${block.source.data.slice(0, 48)}`
  return `${block.type}:${block.text}`
}

function findLatestApprovalRequest(messages: AgentMessage[]): AgentApprovalRequest | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') continue

    const toolUses = new Map<string, Extract<AgentContentBlock, { type: 'tool_use' }>>()
    for (const block of message.content) {
      if (block.type === 'tool_use') toolUses.set(block.toolUseId, block)
      if (block.type !== 'tool_result' || !block.isError) continue

      const toolUse = toolUses.get(block.toolUseId)
      if (!toolUse) continue
      const formatted = formatClaudeToolCall(
        toolUse.name,
        toolUse.input,
        { content: block.content, isError: block.isError },
        'error'
      )
      if (!formatted.needsApproval || !formatted.approvalHint) continue
      return {
        toolUseId: toolUse.toolUseId,
        command: commandFromInput(toolUse.input) || formatted.summary,
        hint: formatted.approvalHint,
        allowedTools: [toolUse.name]
      }
    }
  }
  return undefined
}

function commandFromInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const command = (input as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

// 拿最后一条 assistant 消息所有 text block 的拼接，用来判断错误内容是否已经
// 被 claude 自己写在回复里（避免再加 system 红条重复）。
function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    return msg.content
      .filter((b): b is Extract<AgentContentBlock, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('\n')
  }
  return ''
}

function blocksSinceLastUser(messages: AgentMessage[]): AgentContentBlock[] {
  let start = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      start = i
      break
    }
  }

  return messages
    .slice(start + 1)
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.content)
}
