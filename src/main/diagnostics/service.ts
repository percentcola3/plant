import { isAbsolute, relative } from 'node:path'
import {
  sanitizeAttributes,
  sanitizeCorrelationId,
  serializeDiagnosticError,
  type DiagnosticPrimitive
} from './redact'

export type DiagnosticLevel = 'info' | 'warn' | 'error'
export type DiagnosticStatus = 'completed' | 'error' | 'aborted'

export type DiagnosticEntry = {
  timestamp: string
  level: DiagnosticLevel
  category: string
  event: string
  turnId?: string
  sessionId?: string
  durationMs?: number
  status?: DiagnosticStatus
  attributes?: Record<string, DiagnosticPrimitive>
  error?: ReturnType<typeof serializeDiagnosticError>
}

type DiagnosticFields = Omit<
  DiagnosticEntry,
  'timestamp' | 'level' | 'category' | 'event' | 'attributes'
> & { attributes?: Record<string, unknown> }

type AiTurnState = {
  sessionId: string
  projectPath: string
  startedAt: number
  spawnedAt?: number
  firstProtocolAt?: number
  firstAssistantAt?: number
  firstVisibleTextAt?: number
  resume?: boolean
  result?: AiResultMetrics
  retrievalIntervals: Array<{ startedAt: number; finishedAt?: number }>
  retrievalCount: number
  knowledgeRetrievalCount: number
  codeRetrievalCount: number
  writeCount: number
  tools: Map<string, AiToolState>
}

type AiToolState = {
  startedAt: number
  toolName: string
  toolCategory: 'knowledge_retrieval' | 'code_retrieval' | 'other_tool'
  relativePath?: string
  inputBytes: number
  retrievalInterval?: { startedAt: number; finishedAt?: number }
}

type AiResultMetrics = {
  claudeDurationMs?: number
  apiDurationMs?: number
  numTurns?: number
  totalCostUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

type StreamBlock = {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

type StreamEvent = {
  type?: string
  message?: { content?: StreamBlock[] }
  event?: { delta?: { text?: string } }
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  total_cost_usd?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export type DiagnosticsService = ReturnType<typeof createDiagnosticsService>

export function createDiagnosticsService(input: {
  now?: () => number
  write: (entry: DiagnosticEntry) => void
}) {
  const now = input.now ?? Date.now
  const turns = new Map<string, AiTurnState>()

  function emit(
    level: DiagnosticLevel,
    event: string,
    fields: DiagnosticFields = {},
    emittedAt = now()
  ): void {
    try {
      const { attributes, turnId, sessionId, ...safeFields } = fields
      const entry: DiagnosticEntry = {
        timestamp: new Date(emittedAt).toISOString(),
        level,
        category: event.split('.')[0] || 'app',
        event,
        ...safeFields,
        ...(turnId ? { turnId: sanitizeCorrelationId(turnId) } : {}),
        ...(sessionId ? { sessionId: sanitizeCorrelationId(sessionId) } : {}),
        ...(attributes ? { attributes: sanitizeAttributes(attributes) } : {})
      }
      input.write(entry)
    } catch {
      // Diagnostics must never interrupt the user flow.
    }
  }

  function info(
    event: string,
    attributes: Record<string, unknown> = {},
    correlation: { turnId?: string; sessionId?: string } = {}
  ): void {
    emit('info', event, { ...correlation, attributes })
  }

  function warn(
    event: string,
    attributes: Record<string, unknown> = {},
    correlation: { turnId?: string; sessionId?: string } = {}
  ): void {
    emit('warn', event, { ...correlation, attributes })
  }

  function error(
    event: string,
    cause: unknown,
    attributes: Record<string, unknown> = {},
    correlation: { turnId?: string; sessionId?: string } = {}
  ): void {
    emit('error', event, { ...correlation, attributes, error: serializeDiagnosticError(cause) })
  }

  function startAiTurn(turn: { turnId: string; sessionId: string; projectPath: string }): void {
    const startedAt = now()
    turns.set(turn.turnId, {
      sessionId: turn.sessionId,
      projectPath: turn.projectPath,
      startedAt,
      retrievalIntervals: [],
      retrievalCount: 0,
      knowledgeRetrievalCount: 0,
      codeRetrievalCount: 0,
      writeCount: 0,
      tools: new Map()
    })
    emit('info', 'ai.turn.submitted', { turnId: turn.turnId, sessionId: turn.sessionId }, startedAt)
  }

  function emitAiMilestone(event: string, turnId: string): void {
    const turn = turns.get(turnId)
    if (!turn) return
    const at = now()
    emit('info', event, {
      turnId,
      sessionId: turn.sessionId,
      durationMs: at - turn.startedAt
    }, at)
  }

  function markAiContextReady(turnId: string): void {
    emitAiMilestone('ai.turn.context_ready', turnId)
  }

  function markAiSpawned(turnId: string, attributes: { resume?: boolean } = {}): void {
    const turn = turns.get(turnId)
    if (!turn) return
    const at = now()
    turn.spawnedAt = at
    turn.resume = attributes.resume
    emit('info', 'ai.turn.spawned', {
      turnId,
      sessionId: turn.sessionId,
      durationMs: at - turn.startedAt,
      attributes
    }, at)
  }

  function markAiFirstProtocolEvent(turnId: string): void {
    const turn = turns.get(turnId)
    if (!turn || turn.firstProtocolAt !== undefined) return
    const at = now()
    turn.firstProtocolAt = at
    emit('info', 'ai.turn.first_protocol_event', {
      turnId,
      sessionId: turn.sessionId,
      durationMs: at - turn.startedAt
    }, at)
  }

  function observeAiEvent(turnId: string, rawEvent: unknown): void {
    const turn = turns.get(turnId)
    if (!turn || !rawEvent || typeof rawEvent !== 'object') return
    const event = rawEvent as StreamEvent
    const eventAt = now()

    if (event.type === 'assistant' && turn.firstAssistantAt === undefined) {
      turn.firstAssistantAt = eventAt
      emit('info', 'ai.turn.first_assistant', {
        turnId,
        sessionId: turn.sessionId,
        durationMs: eventAt - turn.startedAt
      }, eventAt)
    }
    if (turn.firstVisibleTextAt === undefined && hasVisibleText(event)) {
      turn.firstVisibleTextAt = eventAt
      emit('info', 'ai.turn.first_visible_text', {
        turnId,
        sessionId: turn.sessionId,
        durationMs: eventAt - turn.startedAt
      }, eventAt)
    }
    if (event.type === 'result') {
      turn.result = resultMetrics(event)
    }

    const blocks = event.message?.content
    if (!Array.isArray(blocks)) return

    for (const block of blocks) {
      if (block.type === 'tool_use' && block.id && block.name) {
        const startedAt = eventAt
        const path = toolPath(block.input)
        const relativePath = safeRelativePath(turn.projectPath, path)
        const toolCategory = classifyTool(block.name, relativePath, block.input)
        const retrievalInterval = toolCategory === 'other_tool'
          ? undefined
          : { startedAt }
        const tool: AiToolState = {
          startedAt,
          toolName: block.name,
          toolCategory,
          inputBytes: byteLength(block.input),
          ...(relativePath ? { relativePath } : {}),
          ...(retrievalInterval ? { retrievalInterval } : {})
        }
        if (retrievalInterval) {
          turn.retrievalIntervals.push(retrievalInterval)
          turn.retrievalCount += 1
          if (toolCategory === 'knowledge_retrieval') turn.knowledgeRetrievalCount += 1
          if (toolCategory === 'code_retrieval') turn.codeRetrievalCount += 1
        }
        if (['Write', 'Edit', 'NotebookEdit'].includes(block.name)) turn.writeCount += 1
        turn.tools.set(block.id, tool)
        emit('info', 'ai.tool.started', {
          turnId,
          sessionId: turn.sessionId,
          attributes: toolAttributes(tool)
        }, startedAt)
      }

      if (block.type === 'tool_result' && block.tool_use_id) {
        const tool = turn.tools.get(block.tool_use_id)
        if (!tool) continue
        const finishedAt = eventAt
        const success = block.is_error !== true
        if (tool.retrievalInterval) tool.retrievalInterval.finishedAt = finishedAt
        emit(success ? 'info' : 'warn', 'ai.tool.finished', {
          turnId,
          sessionId: turn.sessionId,
          durationMs: finishedAt - tool.startedAt,
          status: success ? 'completed' : 'error',
          attributes: {
            ...toolAttributes(tool),
            success,
            outputBytes: byteLength(block.content)
          }
        }, finishedAt)
        turn.tools.delete(block.tool_use_id)
      }
    }
  }

  function finishAiTurn(turnId: string, status: DiagnosticStatus): void {
    const turn = turns.get(turnId)
    if (!turn) return
    const finishedAt = now()
    for (const interval of turn.retrievalIntervals) {
      interval.finishedAt ??= finishedAt
    }
    emit('info', 'ai.turn.summary', {
      turnId,
      sessionId: turn.sessionId,
      durationMs: finishedAt - turn.startedAt,
      status,
      attributes: summaryAttributes(turn, finishedAt)
    }, finishedAt)
    emit(status === 'error' ? 'error' : 'info', 'ai.turn.finished', {
      turnId,
      sessionId: turn.sessionId,
      durationMs: finishedAt - turn.startedAt,
      status
    }, finishedAt)
    turns.delete(turnId)
  }

  return {
    info,
    warn,
    error,
    startAiTurn,
    markAiContextReady,
    markAiSpawned,
    markAiFirstProtocolEvent,
    observeAiEvent,
    finishAiTurn
  }
}

function toolAttributes(tool: AiToolState): Record<string, unknown> {
  return {
    toolName: tool.toolName,
    toolCategory: tool.toolCategory,
    inputBytes: tool.inputBytes,
    ...(tool.relativePath ? { relativePath: tool.relativePath } : {})
  }
}

function byteLength(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value)
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '')
  } catch {
    return 0
  }
}

function toolPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['file_path', 'path']) {
    if (typeof record[key] === 'string' && record[key]) return record[key]
  }
  return undefined
}

function safeRelativePath(projectPath: string, path?: string): string | undefined {
  if (!path) return undefined
  if (!isAbsolute(path)) return path.replace(/^\.\//, '')
  const rel = relative(projectPath, path).replace(/\\/g, '/')
  return rel && !rel.startsWith('../') && rel !== '..' ? rel : undefined
}

function classifyTool(
  toolName: string,
  relativePath?: string,
  input?: unknown
): AiToolState['toolCategory'] {
  if (toolName === 'Bash') return classifyBashSearch(input)
  if (!['Read', 'Grep', 'Glob'].includes(toolName)) return 'other_tool'
  if (relativePath === '.external' || relativePath?.startsWith('.external/')) {
    return 'knowledge_retrieval'
  }
  return relativePath ? 'code_retrieval' : 'other_tool'
}

function classifyBashSearch(input: unknown): AiToolState['toolCategory'] {
  if (!input || typeof input !== 'object') return 'other_tool'
  const command = (input as Record<string, unknown>).command
  if (typeof command !== 'string') return 'other_tool'
  if (!/(^|[;&|()]|\s)(rg|grep|find|fd|ls)(?=\s|$)/.test(command)) return 'other_tool'
  return /(^|[\s'"=])(?:\.\/)?\.external(?:\/|\s|'|"|$)/.test(command)
    ? 'knowledge_retrieval'
    : 'code_retrieval'
}

function hasVisibleText(event: StreamEvent): boolean {
  if (typeof event.event?.delta?.text === 'string' && event.event.delta.text.trim()) return true
  if (event.type !== 'assistant') return false
  return (event.message?.content ?? []).some((block) =>
    block.type === 'text'
    && typeof block.text === 'string'
    && Boolean(block.text.trim())
  )
}

function resultMetrics(event: StreamEvent): AiResultMetrics {
  return {
    ...numberField('claudeDurationMs', event.duration_ms),
    ...numberField('apiDurationMs', event.duration_api_ms),
    ...numberField('numTurns', event.num_turns),
    ...numberField('totalCostUsd', event.total_cost_usd),
    ...numberField('inputTokens', event.usage?.input_tokens),
    ...numberField('outputTokens', event.usage?.output_tokens),
    ...numberField('cacheCreationInputTokens', event.usage?.cache_creation_input_tokens),
    ...numberField('cacheReadInputTokens', event.usage?.cache_read_input_tokens)
  }
}

function numberField<K extends keyof AiResultMetrics>(
  key: K,
  value: unknown
): Pick<AiResultMetrics, K> | Record<string, never> {
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } as Pick<AiResultMetrics, K> : {}
}

function summaryAttributes(turn: AiTurnState, finishedAt: number): Record<string, unknown> {
  return {
    ...(turn.spawnedAt !== undefined ? { appPrepareMs: turn.spawnedAt - turn.startedAt } : {}),
    ...(turn.firstProtocolAt !== undefined ? { firstProtocolMs: turn.firstProtocolAt - turn.startedAt } : {}),
    ...(turn.firstAssistantAt !== undefined ? { firstAssistantMs: turn.firstAssistantAt - turn.startedAt } : {}),
    ...(turn.firstVisibleTextAt !== undefined ? { firstVisibleTextMs: turn.firstVisibleTextAt - turn.startedAt } : {}),
    retrievalCount: turn.retrievalCount,
    retrievalWallMs: intervalUnionMs(turn.retrievalIntervals, finishedAt),
    knowledgeRetrievalCount: turn.knowledgeRetrievalCount,
    codeRetrievalCount: turn.codeRetrievalCount,
    writeCount: turn.writeCount,
    ...(turn.resume !== undefined ? { resume: turn.resume } : {}),
    ...turn.result
  }
}

function intervalUnionMs(
  intervals: Array<{ startedAt: number; finishedAt?: number }>,
  fallbackFinishedAt: number
): number {
  const sorted = intervals
    .map((interval) => [interval.startedAt, interval.finishedAt ?? fallbackFinishedAt] as const)
    .sort((a, b) => a[0] - b[0])
  let total = 0
  let currentStart: number | undefined
  let currentEnd: number | undefined
  for (const [start, end] of sorted) {
    if (currentStart === undefined) {
      currentStart = start
      currentEnd = end
    } else if (start <= currentEnd!) {
      currentEnd = Math.max(currentEnd!, end)
    } else {
      total += currentEnd! - currentStart
      currentStart = start
      currentEnd = end
    }
  }
  return currentStart === undefined ? 0 : total + currentEnd! - currentStart
}
