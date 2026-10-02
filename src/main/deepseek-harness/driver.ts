import { runOfficialDshTurn } from './official-loop'
import { settingsStore } from '../settings/store'
import type { PlantConnection } from '../../shared/plant'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { AgentDriver } from '../claude-headless/driver/types'
import type { StreamJsonEvent, TurnHandle, TurnInput } from '../claude-headless/spawn-turn'
import { compareArtifactSnapshots, snapshotProjectArtifacts } from '../claude-headless/artifact-tracker'
import { findOutOfScopeArtifacts, readEditableRoots } from '../claude-headless/scope-warning'
import { diagnostics } from '../diagnostics/runtime'
import { deepSeekCredentialStore } from './credentials'
import { buildHarnessContext } from './context'
import { createHarnessToolbox } from './tools'
import { createDeepSeekCompletion, type DeepSeekAssistantMessage, type DeepSeekMessage } from './api'
import { appendDeepSeekEvent, loadDeepSeekMessages } from './transcript'

const REQUEST_TIMEOUT_MS = 120_000
const ROLE_MARKER_RE = /^#{1,3}\s*(user|assistant|system)\s*$/im

type ExitDetails = {
  status: 'completed' | 'error' | 'aborted'
  changedArtifacts: string[]
  errorMessage?: string
}

type ActiveTurn = {
  handle: TurnHandle
  completion: Promise<void>
}

export class DeepSeekHarnessDriver implements AgentDriver {
  private readonly activeTurns = new Map<string, ActiveTurn>()

  submit(input: TurnInput): TurnHandle {
    const turn = createDeepSeekTurn(input)
    this.activeTurns.set(input.sessionId, turn)
    void turn.completion.finally(() => {
      if (this.activeTurns.get(input.sessionId)?.handle === turn.handle) {
        this.activeTurns.delete(input.sessionId)
      }
    })
    return turn.handle
  }

  async abort(sessionId: string): Promise<boolean> {
    const active = this.activeTurns.get(sessionId)
    if (!active) return false
    await active.handle.abort()
    this.activeTurns.delete(sessionId)
    return true
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.has(sessionId)
  }

  async shutdown(): Promise<void> {
    const turns = [...this.activeTurns.values()]
    this.activeTurns.clear()
    await Promise.all(turns.map((turn) => turn.handle.abort().catch(() => undefined)))
  }
}

function createDeepSeekTurn(input: TurnInput): ActiveTurn {
  const controller = new AbortController()
  const eventListeners = new Set<(event: StreamJsonEvent) => void>()
  const exitListeners = new Set<(code: number | null, signal?: string, details?: ExitDetails) => void>()
  const win = BrowserWindow.fromId(input.ownerWindowId)
  const turnId = input.turnId ?? input.sessionId
  const artifactsBefore = snapshotProjectArtifacts(input.projectPath)
  let finished = false
  let exitState: { code: number | null; signal?: string; details: ExitDetails } | null = null
  let timedOut = false
  let firstEvent = true
  let resolveCompletion!: () => void
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })

  const emit = (event: StreamJsonEvent): void => {
    appendDeepSeekEvent(input.sessionId, event)
    diagnostics.observeAiEvent(turnId, event)
    if (firstEvent) {
      firstEvent = false
      diagnostics.markAiFirstProtocolEvent(turnId)
    }
    for (const listener of eventListeners) listener(event)
    win?.webContents.send(`claude.delta:${input.sessionId}`, event)
  }

  const finish = (status: ExitDetails['status'], errorMessage?: string): void => {
    if (finished) return
    finished = true
    const changedArtifacts = changedArtifactsFor(input.projectPath, artifactsBefore)
    const editableRoots = readEditableRoots(input.projectPath)
    const outOfScopeArtifacts = findOutOfScopeArtifacts(changedArtifacts, editableRoots)
    const details: ExitDetails = { status, changedArtifacts, ...(errorMessage ? { errorMessage } : {}) }
    const code = status === 'completed' ? 0 : status === 'error' ? 1 : null
    const signal = status === 'aborted' ? 'SIGTERM' : undefined
    exitState = { code, signal, details }
    diagnostics.finishAiTurn(turnId, status)
    for (const listener of exitListeners) listener(code, signal, details)
    win?.webContents.send(`claude.turn-end:${input.sessionId}`, {
      status,
      exitCode: code,
      changedArtifacts,
      outOfScopeArtifacts,
      editableRoots,
      errorMessage
    })
    resolveCompletion()
  }

  const run = async (): Promise<void> => {
    try {
      const connection = { ...(await settingsStore.get()).plantConnection }
      const apiKey = await deepSeekCredentialStore.getApiKey()
      if (!apiKey) throw new Error('未配置 DeepSeek API key，请先在设置的「AI 助手」中配置')
      if (controller.signal.aborted) throw abortError()

      const workDir = input.workDir ?? input.projectPath
      const context = await buildHarnessContext({
        projectPath: input.projectPath,
        workDir,
        addDirs: input.addDirs ?? []
      })
      const toolbox = createHarnessToolbox({ projectPath: input.projectPath, workDir, context })
      diagnostics.markAiSpawned(turnId, { resume: !!input.resume })

      emit({
        type: 'user',
        uuid: randomUUID(),
        message: { role: 'user', content: input.content }
      })

      const messages: DeepSeekMessage[] = [
        { role: 'system', content: context.systemPrompt },
        ...loadDeepSeekMessages(input.sessionId)
      ]

      const finalText = await runOfficialDshTurn({
        sessionId: input.sessionId,
        workDir,
        messages,
        toolbox,
        signal: controller.signal,
        request: (turnMessages, signal) => requestWithTimeout({
          apiKey, connection, messages: turnMessages, tools: toolbox.definitions,
          controller, signal, onTimeout: () => { timedOut = true }
        }),
        onAssistant: (assistant) => {
          assertSafeAssistantText(assistant)
          emit(assistantEventFrom(assistant))
        },
        onToolResult: (callId, content, isError) => emit({
          type: 'user', uuid: randomUUID(),
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content, is_error: isError }] }
        })
      })
      emit({ type: 'result', subtype: 'success', uuid: randomUUID(), result: finalText, is_error: false })
      finish('completed')
    } catch (error) {
      if (controller.signal.aborted && !timedOut) {
        finish('aborted')
        return
      }
      const message = timedOut
        ? `DeepSeek 请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`
        : error instanceof Error ? error.message : String(error)
      try {
        emit({ type: 'result', subtype: 'error', uuid: randomUUID(), result: message, is_error: true })
      } catch {
        // Transcript failures still need to release the turn.
      }
      finish('error', message)
    }
  }

  queueMicrotask(() => { void run() })

  const handle: TurnHandle = {
    pid: process.pid,
    async abort() {
      if (finished) return
      controller.abort()
      await completion
    },
    onEvent(callback) {
      eventListeners.add(callback)
      return () => { eventListeners.delete(callback) }
    },
    onExit(callback) {
      if (exitState) {
        callback(exitState.code, exitState.signal, exitState.details)
        return () => undefined
      }
      exitListeners.add(callback)
      return () => { exitListeners.delete(callback) }
    }
  }
  return { handle, completion }
}

function assistantEventFrom(message: DeepSeekAssistantMessage): StreamJsonEvent {
  const content: NonNullable<StreamJsonEvent['message']>['content'] = []
  if (message.reasoning_content?.trim()) {
    content.push({ type: 'thinking', thinking: message.reasoning_content })
  }
  if (message.content?.trim()) content.push({ type: 'text', text: message.content })
  for (const call of message.tool_calls ?? []) {
    let parsedInput: unknown = {}
    try { parsedInput = JSON.parse(call.function.arguments || '{}') } catch { parsedInput = call.function.arguments }
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parsedInput
    })
  }
  return {
    type: 'assistant',
    uuid: randomUUID(),
    message: { role: 'assistant', content }
  }
}

async function requestWithTimeout(input: {
  apiKey: string
  connection: PlantConnection
  messages: DeepSeekMessage[]
  tools: ReturnType<typeof createHarnessToolbox>['definitions']
  controller: AbortController
  signal: AbortSignal
  onTimeout: () => void
}): Promise<DeepSeekAssistantMessage> {
  const timer = setTimeout(() => {
    input.onTimeout()
    input.controller.abort()
  }, REQUEST_TIMEOUT_MS)
  try {
    return await createDeepSeekCompletion({
      apiKey: input.apiKey,
      connection: input.connection,
      messages: input.messages,
      tools: input.tools,
      signal: input.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

function assertSafeAssistantText(message: DeepSeekAssistantMessage): void {
  const text = message.content ?? ''
  const match = ROLE_MARKER_RE.exec(text)
  if (match) throw new Error(`检测到伪造的角色标记（## ${match[1]}），已中止以防对话被劫持`)
}

function changedArtifactsFor(
  projectPath: string,
  before: ReturnType<typeof snapshotProjectArtifacts>
): string[] {
  try {
    return compareArtifactSnapshots(before, snapshotProjectArtifacts(projectPath))
  } catch {
    return []
  }
}

function abortError(): Error {
  return Object.assign(new Error('DeepSeek turn aborted'), { name: 'AbortError' })
}
