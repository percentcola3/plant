export type AgentRole = 'user' | 'assistant' | 'system'

export type AgentContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError?: boolean }
  | { type: 'image'; source: { mediaType: string; data: string } }

// 提交时附带的 chip 元数据。用于 resend 时还原 selector 上下文给 Claude。
// 仅出现在 role === 'user' 且来自 beginTurn 的 optimistic 消息上；
// 历史回放（JSONL）出来的 user message 没有这个字段。
export type AgentMessageChipRef = {
  alias: string
  path: string
  tagName?: string
  textPreview?: string
  edits?: Record<string, string>
}

export type AgentMessage = {
  uuid: string
  role: AgentRole
  content: AgentContentBlock[]
  inFlight: boolean
  abortedAt?: number
  createdAt: number
  providerMessageId?: string
  chipsForResend?: AgentMessageChipRef[]
}

export type AgentApprovalRequest = {
  toolUseId: string
  command: string
  hint: string
  allowedTools: string[]
}

export type AgentTurnStatus =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'waitingApproval'
  | 'toolRunning'
  | 'streaming'
  | 'completed'
  | 'aborted'
  | 'error'

export type AgentTurnOutcome =
  | 'responded'
  | 'wroteFiles'
  | 'noWrite'
  | 'toolOnly'
  | 'noResponse'
  | 'failed'

export type AgentTurnState = {
  status: AgentTurnStatus
  outcome?: AgentTurnOutcome
  approvalRequest?: AgentApprovalRequest
  changedArtifacts: string[]
  errorMessage?: string
}

export type NormalizedAgentEvent =
  | { type: 'ignore'; reason: string }
  | { type: 'message.user'; uuid: string; content: AgentContentBlock[] }
  | {
      type: 'message.assistant'
      uuid: string
      providerMessageId?: string
      content: AgentContentBlock[]
      inFlight: boolean
    }
  | { type: 'tool.result'; uuid: string; content: Extract<AgentContentBlock, { type: 'tool_result' }>[] }
  | { type: 'approval.resolved'; uuid?: string; decision: 'allow' | 'deny' }
  | { type: 'turn.completed'; uuid?: string; status: 'completed' | 'error'; changedArtifacts?: string[]; errorMessage?: string; finalText?: string }
  | { type: 'turn.aborted'; uuid?: string }
  // P4 流式文本：--include-partial-messages 开启后，claude 的 stream_event
  // content_block_delta text_delta 被归一化成 text.delta，逐 token 推给 reducer。
  // providerMessageId 让 reducer 定位到正确的 assistant message（首个 delta 可能
  // 先于 assistant 整消息到达，reducer 会预创建 message）。
  | { type: 'text.delta'; uuid: string; providerMessageId?: string; delta: string }

export type ClaudeRawEvent = {
  type: string
  uuid?: string
  isMeta?: unknown
  message?: {
    id?: unknown
    model?: unknown
    role?: unknown
    content?: unknown[]
  }
  result?: unknown
  [key: string]: unknown
}
