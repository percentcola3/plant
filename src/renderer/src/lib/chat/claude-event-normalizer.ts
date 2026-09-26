import {
  approvalCommandFromContinuationPrompt
} from './display-state'
import type {
  AgentContentBlock,
  ClaudeRawEvent,
  NormalizedAgentEvent
} from './agent-events'

export type NormalizeOptions = {
  assistantInFlight?: boolean
}

export function normalizeClaudeEvent(
  event: ClaudeRawEvent,
  options: NormalizeOptions = {}
): NormalizedAgentEvent[] {
  const uuid = event.uuid ?? ''

  if (event.isMeta === true) {
    return [{ type: 'ignore', reason: 'internal-meta' }]
  }

  // P4 流式文本：--include-partial-messages 开启后 claude 发 stream_event，
  // 其中 content_block_delta 的 text_delta 是逐 token 的文本增量。
  // 归一化成 text.delta 推给 reducer，reducer 把增量合并进 assistant message。
  // message_start 提供 providerMessageId（让 reducer 定位正确 message）。
  if (event.type === 'stream_event' && event.event && typeof event.event === 'object') {
    return normalizeStreamEvent(event.event as Record<string, unknown>, uuid)
  }

  if (event.type === 'result') {
    // stream-json 的 result 事件实际形态：
    //   { type: 'result', subtype: 'success' | 'error_during_execution' | ...,
    //     is_error: boolean, result: '<final text or error message>' }
    // 旧实现拿 event.result === 'error' 永远命中不到（result 是消息内容不是状态字符串）。
    // 兼容历史 mock：还允许 subtype === 'error' 显式标错。
    const record = event as Record<string, unknown>
    const isError = record.is_error === true
      || (typeof record.subtype === 'string' && record.subtype.startsWith('error'))
    const status = isError ? 'error' : 'completed'
    const errorMessage = isError ? resultErrorMessage(event) : undefined
    // 成功时 result 字段是模型最终答案。当 turn 以工具调用收尾（没有最终 assistant
    // 文本消息）或文本被回声抑制剥空时，这是唯一的结论文本来源，必须带给 reducer
    // 落地成消息，否则面板只剩思考胶囊 + 空白。
    const finalText = !isError && typeof record.result === 'string' && record.result.trim()
      ? record.result
      : undefined
    return [{
      type: 'turn.completed',
      uuid,
      status,
      ...(errorMessage ? { errorMessage } : {}),
      ...(finalText ? { finalText } : {})
    }]
  }

  const message = event.message
  if (!message) return [{ type: 'ignore', reason: 'missing-message' }]

  if (isSyntheticNoResponse(event, message)) {
    return [{ type: 'ignore', reason: 'synthetic-no-response' }]
  }

  const content = parseContentBlocks(message.content ?? [])
  if (event.type === 'assistant') {
    if (content.length === 0) return [{ type: 'ignore', reason: 'empty-assistant-content' }]
    return [{
      type: 'message.assistant',
      uuid,
      providerMessageId: providerMessageIdFrom(message),
      content,
      inFlight: options.assistantInFlight === true
    }]
  }

  if (event.type === 'user') {
    if (content.length === 0) return [{ type: 'ignore', reason: 'empty-user-content' }]
    const onlyToolResults = content.every((block): block is Extract<AgentContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
    if (onlyToolResults) return [{ type: 'tool.result', uuid, content }]

    const approvalResolved = approvalResolvedEvent(uuid, content)
    if (approvalResolved) return [approvalResolved]

    return [{
      type: 'message.user',
      uuid,
      content: normalizeVisibleUserContent(content)
    }]
  }

  return [{ type: 'ignore', reason: `unsupported:${event.type}` }]
}

function resultErrorMessage(event: ClaudeRawEvent): string | undefined {
  const record = event as Record<string, unknown>
  // stream-json 错误：消息体在 result 字段里
  if (typeof record.result === 'string' && record.result.trim()) return record.result.trim()
  // 兼容老 mock / 其它驱动：errorMessage / error / message 字段
  const direct = record.errorMessage ?? record.error ?? record.message
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (direct && typeof direct === 'object') {
    const nested = direct as Record<string, unknown>
    const nestedMessage = nested.message ?? nested.error
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim()
  }
  // 兜底：subtype 当作错误简述
  if (typeof record.subtype === 'string' && record.subtype.trim()) {
    return `Claude 执行失败：${record.subtype}`
  }
  return undefined
}

function normalizeVisibleUserContent(content: AgentContentBlock[]): AgentContentBlock[] {
  return content.map((block) => {
    if (block.type !== 'text') return block
    return { ...block, text: extractVisibleUserInstruction(block.text) }
  })
}

// compose-prompt.ts 注入的内部 section header。任意一个出现在 `## 用户指令` 之前，
// 就把前面那段视作"我们的 prompt 注入"，从用户气泡里擦掉。
// 注意：每加一个新 header（compose-prompt 端）就要同步加进这里，否则用户气泡会
// 漏出 prompt 残渣（A6 那种）。
const INTERNAL_PROMPT_HEADERS = [
  '## 当前编辑文档',
  '## 上下文',
  '## 当前可编辑区域',
  '## 当前分支工作范围',
  '## 资源包使用说明',
  '## 可用知识库'
] as const

function extractVisibleUserInstruction(text: string): string {
  const marker = /^## 用户指令\s*$/m
  const match = marker.exec(text)
  if (!match || match.index === undefined) return text

  const before = text.slice(0, match.index)
  const hasInternalContext = INTERNAL_PROMPT_HEADERS.some(header =>
    new RegExp(`^${header}\\s*$`, 'm').test(before)
  )
  if (!hasInternalContext) return text

  return text.slice(match.index + match[0].length).replace(/^\n+/, '').trimEnd()
}

function isSyntheticNoResponse(
  event: ClaudeRawEvent,
  message: NonNullable<ClaudeRawEvent['message']>
): boolean {
  if (event.type !== 'assistant' || message.model !== '<synthetic>') return false
  const content = message.content ?? []
  if (content.length !== 1) return false
  const block = content[0] as Record<string, unknown>
  return block.type === 'text' && String(block.text ?? '').trim() === 'No response requested.'
}

function providerMessageIdFrom(message: { id?: unknown }): string | undefined {
  return typeof message.id === 'string' ? message.id : undefined
}

// P4：把 claude stream_event（--include-partial-messages）归一化成 NormalizedAgentEvent。
//
// stream_event 是 claude SDK 的 Anthropic 原生事件透传，核心几种：
//   - message_start         { message: { id } }          → 忽略（providerMessageId 走 assistant 整消息）
//   - content_block_delta   { delta: { type, text } }    → 只处理 text_delta 转 text.delta
//   - content_block_stop    { content_block: { type: 'tool_use' } }  → 忽略（见下）
//   - message_stop                                       → 忽略
//
// tool_use 去重策略（②）：
//   开 partial-messages 后 tool_use 会先在 stream_event 的 input_json_delta 增量流出，
//   又在 assistant 整消息里再发一次。我们不 emit stream_event 的 tool_use，只保留
//   assistant 整消息的版本——天然只有一份，无需 streamedToolUseIds 去重。
//   代价：tool_use 不流式（要等整消息才显示），但跟改造前行为一致，不是回归。
//   input 是 claude 最终解析的完整值，比 stream 拼装的 JSON.parse 更可靠。
//
// thinking_delta 暂不流式（reducer 还没 thinking 增量合并），仍走 assistant 整消息。
function normalizeStreamEvent(
  ev: Record<string, unknown>,
  uuid: string
): NormalizedAgentEvent[] {
  const type = typeof ev.type === 'string' ? ev.type : ''

  if (type === 'content_block_delta') {
    const delta = ev.delta as Record<string, unknown> | undefined
    if (!delta) return [{ type: 'ignore', reason: 'stream_event:no-delta' }]
    // 只处理 text_delta；input_json_delta（tool_use 增量）和 thinking_delta 暂忽略
    if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
      // content_block_delta 不带 message id，providerMessageId 留空，
      // reducer 用"最后一条 in-flight assistant"兜底定位。
      return [{ type: 'text.delta', uuid, delta: delta.text }]
    }
    return [{ type: 'ignore', reason: `stream_event:delta-${delta.type ?? 'unknown'}` }]
  }

  // 其他 stream_event 类型忽略。文本流靠 content_block_delta，
  // message / tool_use 边界靠 assistant 整消息（保持双轨兼容）。
  return [{ type: 'ignore', reason: `stream_event:${type || 'unknown'}` }]
}

function approvalResolvedEvent(
  uuid: string,
  content: AgentContentBlock[]
): NormalizedAgentEvent | null {
  if (content.length !== 1 || content[0].type !== 'text') return null
  return approvalCommandFromContinuationPrompt(content[0].text)
    ? { type: 'approval.resolved', uuid, decision: 'allow' }
    : null
}

export function parseContentBlocks(content: unknown[]): AgentContentBlock[] {
  const result: AgentContentBlock[] = []
  for (const block of content) {
    const b = block as Record<string, unknown>
    if (b.type === 'text') {
      result.push({ type: 'text', text: String(b.text ?? '') })
    } else if (b.type === 'thinking') {
      const text = String(b.thinking ?? b.text ?? '')
      if (text) result.push({ type: 'thinking', text })
    } else if (b.type === 'tool_use') {
      result.push({
        type: 'tool_use',
        toolUseId: String(b.id ?? ''),
        name: String(b.name ?? ''),
        input: b.input
      })
    } else if (b.type === 'tool_result') {
      result.push({
        type: 'tool_result',
        toolUseId: String(b.tool_use_id ?? ''),
        content: b.content,
        isError: b.is_error === true
      })
    } else if (b.type === 'image') {
      const source = b.source as Record<string, unknown> | undefined
      result.push({
        type: 'image',
        source: {
          mediaType: String(source?.media_type ?? ''),
          data: String(source?.data ?? '')
        }
      })
    }
  }
  return result
}
