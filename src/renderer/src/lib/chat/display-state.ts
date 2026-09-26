import { formatClaudeToolCall } from '@shared/claude-display'
import type { AgentTurnState } from './agent-events'

type DisplayBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError?: boolean }
  | { type: 'image'; source: { mediaType: string; data: string } }

export type DisplayMessage = {
  role: string
  content: DisplayBlock[]
}

export type ApprovalRequestView = {
  command: string
  hint: string
  approvalPrompt: string
  allowedTools: string[]
}

export type TurnStatusNotice = {
  tone: 'running' | 'warning' | 'success'
  title: string
  detail: string
}

export const APPROVAL_CONTINUATION_DISPLAY_TEXT = '已授权，继续执行'
const APPROVAL_CONTINUATION_INTRO = '我已在 UI 中授权执行下面这条 Bash 命令。'
const APPROVAL_CONTINUATION_TASK = '请继续完成原任务。'
const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit'])
const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate'])

function commandFromInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const command = (input as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

export function buildApprovalContinuationPrompt(command: string): string {
  return [
    APPROVAL_CONTINUATION_INTRO,
    APPROVAL_CONTINUATION_TASK,
    '',
    command
  ].join('\n')
}

export function approvalCommandFromContinuationPrompt(text: string): string | null {
  const lines = text.trim().split('\n')
  if (lines[0] !== APPROVAL_CONTINUATION_INTRO) return null
  if (lines[1] !== APPROVAL_CONTINUATION_TASK) return null
  const command = lines.slice(2).join('\n').trim()
  return command || null
}

export function isApprovalContinuationDisplayText(text: string): boolean {
  return text.trim() === APPROVAL_CONTINUATION_DISPLAY_TEXT
}

export function normalizeApprovalContinuationText(text: string): string {
  return approvalCommandFromContinuationPrompt(text) ? APPROVAL_CONTINUATION_DISPLAY_TEXT : text
}

function singleTextFromMessage(msg: DisplayMessage): string | null {
  if (msg.content.length !== 1) return null
  const block = msg.content[0]
  return block.type === 'text' ? block.text : null
}

export function findLatestApprovalRequest(messages: DisplayMessage[]): ApprovalRequestView | null {
  const resolvedCommands = new Set<string>()
  let resolvedAllOlderRequests = false

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      const text = singleTextFromMessage(msg)
      if (!text) continue
      if (isApprovalContinuationDisplayText(text)) {
        resolvedAllOlderRequests = true
        continue
      }
      const command = approvalCommandFromContinuationPrompt(text)
      if (command) resolvedCommands.add(command)
      continue
    }
    if (msg.role !== 'assistant') continue

    const toolUses = new Map<string, Extract<DisplayBlock, { type: 'tool_use' }>>()
    for (const block of msg.content) {
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
      const command = commandFromInput(toolUse.input) || formatted.summary
      if (resolvedAllOlderRequests || resolvedCommands.has(command)) continue
      return {
        command,
        hint: formatted.approvalHint,
        approvalPrompt: buildApprovalContinuationPrompt(command),
        allowedTools: ['Bash']
      }
    }
  }
  return null
}

// 找出本轮「当前正在执行」的那一个 skill：必须是最后一个尚未收到 tool_result 的
// Skill tool_use（无论成功还是失败，一旦返回就视为执行结束、不再展示）。
// 给 ConversationView 顶部 chip 用 —— 同一时刻最多只有一个 skill 在跑。
export function findRunningSkill(messages: DisplayMessage[]): string | null {
  const blocks = blocksSinceLastUser(messages)

  const completed = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'tool_result') completed.add(block.toolUseId)
  }

  // 反向找最近一个尚未返回的 Skill tool_use
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type !== 'tool_use' || block.name !== 'Skill') continue
    if (completed.has(block.toolUseId)) continue
    const data = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
    const raw = data.skill ?? data.name ?? data.skill_name
    if (typeof raw !== 'string') continue
    const skill = raw.trim()
    if (skill) return skill
  }
  return null
}

export function summarizeTurnActivity(messages: DisplayMessage[], inFlight: boolean): string {
  if (!inFlight) return '空闲'

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue

    const completed = new Set<string>()
    for (const block of msg.content) {
      if (block.type === 'tool_result') completed.add(block.toolUseId)
    }
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j]
      if (block.type !== 'tool_use' || completed.has(block.toolUseId)) continue
      const formatted = formatClaudeToolCall(block.name, block.input, undefined, 'pending')
      return `正在${formatted.title}`
    }
  }

  return '正在整理回复'
}

export function buildTurnStatusNotice(
  messages: DisplayMessage[],
  inFlight: boolean,
  turnState?: Pick<AgentTurnState, 'status' | 'outcome' | 'changedArtifacts' | 'errorMessage'>
): TurnStatusNotice | null {
  if (turnState?.status === 'error') {
    return {
      tone: 'warning',
      title: 'AI 执行失败',
      detail: turnState.errorMessage || '这次请求没有完成。请查看错误提示或终端日志后重试。'
    }
  }

  if (turnState?.status === 'completed' && turnState.outcome === 'noWrite') {
    return {
      tone: 'warning',
      title: '本轮已结束，但没有检测到文档写入',
      detail: '最后只创建或更新了 Claude 任务状态，没有执行 Write/Edit/MultiEdit。文档内容不会自动变化。'
    }
  }

  if (turnState?.status === 'completed'
      && turnState.outcome === 'wroteFiles'
      && (turnState.changedArtifacts?.length ?? 0) > 0) {
    const files = turnState.changedArtifacts ?? []
    return {
      tone: 'success',
      title: `已更新 ${files.length} 个文件`,
      detail: files.slice(0, 5).join('、') + (files.length > 5 ? ` 等 ${files.length} 个文件` : '')
    }
  }

  if (turnState?.status === 'completed' && turnState.outcome === 'wroteFiles') {
    return null
  }

  const blocks = blocksSinceLastUser(messages)
  if (blocks.length === 0) return null

  const toolUses = blocks.filter((block): block is Extract<DisplayBlock, { type: 'tool_use' }> => block.type === 'tool_use')
  if (toolUses.length === 0) return null

  const lastBlock = blocks[blocks.length - 1]
  const endedOnToolResult = lastBlock?.type === 'tool_result'
  if (!endedOnToolResult) return null

  if (inFlight) {
    return {
      tone: 'running',
      title: '工具已返回，等待 Claude 继续',
      detail: '如果长时间没有新内容，可以手动停止当前回合后继续追问。'
    }
  }

  const hasWrite = toolUses.some(block => WRITE_TOOL_NAMES.has(block.name))
  const hasTaskOnlyProgress = toolUses.some(block => TASK_TOOL_NAMES.has(block.name))
  if (!hasWrite && hasTaskOnlyProgress) {
    return {
      tone: 'warning',
      title: '本轮已结束，但没有检测到文档写入',
      detail: '最后只创建或更新了 Claude 任务状态，没有执行 Write/Edit/MultiEdit。文档内容不会自动变化。'
    }
  }

  return null
}

function blocksSinceLastUser(messages: DisplayMessage[]): DisplayBlock[] {
  let start = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      start = i
      break
    }
  }

  return messages
    .slice(start + 1)
    .filter(msg => msg.role === 'assistant')
    .flatMap(msg => msg.content)
}
