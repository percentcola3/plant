// Claude headless IPC handlers：submit / abort / replay / watch
import { BrowserWindow } from 'electron'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import {
  branchScopedWorkspaceKey,
  createWorkspaceSessionId,
  ensureWorkspaceSessionId,
  findSessionJsonlForResume,
  recoverDeadWorkspaceSessionBinding,
  sessionJsonlPathForReplay,
  isClaudeSessionId
} from '../../claude-headless/session-id'
import { getAgentDriver } from '../../claude-headless/driver'
import { probeClaudeCapabilities } from '../../claude-headless/capability-probe'
import { watchJsonl, type WatchHandle } from '../../claude-headless/jsonl-watcher'
import { resolveHarnessAccess } from '../../deepseek-harness/context'
import { readEditableRoots } from '../../claude-headless/scope-warning'
import { getClaudeCapabilitiesSync } from '../../claude-headless/capability-probe'
import { resolveClaudeLaunchContext } from '../../claude-headless/launch-context'
import { WorkspacesStore } from '../../workspaces/store'
import { awaitPendingWorkAreaSync } from '../../workspaces/service'
import { readActiveWorkArea } from '../../workspaces/work-area'
import { projectWatcher, type SpawnLease } from '../../projects/watcher'
import { composeUserMessage, type ExternalRefHint } from '../../claude-headless/compose-prompt'
import { loadResourceInstructions } from '../../claude-headless/resource-instructions'
import { gitFor } from '../../git/client'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { getSharedAiTaskRegistry } from '../../ai-tasks/service'
import { presentAiTaskNotch } from '../../ai-tasks/notch-window'
import { parseClaudeInteraction } from '../../../shared/claude-interactions'
import { ensureZgMcpConfig } from '../../zg/zg-mcp'
import type { AiTaskSummary, AiTaskWorkArea, Workspace } from '../../../shared/types'
import { diagnostics } from '../../diagnostics/runtime'
import { settingsStore } from '../../settings/store'
import { DEFAULT_AI_PROVIDER, type AiProvider } from '../../../shared/ai-provider'
import { deepSeekCredentialStore } from '../../deepseek-harness/credentials'
import {
  deepSeekSessionTranscriptPath,
  hasDeepSeekTranscript
} from '../../deepseek-harness/transcript'

const projectStore = new WorkspacesStore()

// 活跃的 JSONL watcher（与 turn 不同生命周期，仍单独管理）。watchId 是租约：
// 旧面板的延迟 stop 只能停止自己创建的 watcher，不能误停刚重挂的新面板。
type ActiveWatcher = { watchId: string; handle: WatchHandle }
const activeWatchers = new Map<string, ActiveWatcher>()
const latestWatchRequests = new Map<string, string>()
const activeAiTaskRuns = new Map<string, string>()

type TargetDocumentInput = {
  relPath: string
  kind: 'markdown' | 'css' | 'html' | 'text'
  readonly?: boolean
} | undefined
type ScopedTargetWorkspaceInput = { kind: 'workspace-home'; scopeKey?: string; intent?: 'design-prd' } | undefined

function emitAiTaskChanged(task?: AiTaskSummary | null): void {
  for (const target of BrowserWindow.getAllWindows()) {
    target.webContents.send('ai-task.changed', task ?? null)
  }
  // 有任务转到"等我"状态就把灵动岛顶到前台（不抢焦点）
  if (task?.status === 'waiting_user' || task?.status === 'waiting_approval') {
    presentAiTaskNotch()
  }
}

function aiTaskWorkAreaFrom(
  workArea: Awaited<ReturnType<typeof readActiveWorkArea>>,
  targetDocument: TargetDocumentInput
): AiTaskWorkArea {
  if (workArea) return { kind: workArea.kind, relPath: workArea.relPath }
  if (targetDocument?.relPath) return { kind: 'document', relPath: targetDocument.relPath }
  return { kind: 'workspace' }
}

function eventHasPendingUserInteraction(event: { message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } }): boolean {
  const blocks = event.message?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some((block) =>
    block?.type === 'tool_use'
    && typeof block.name === 'string'
    && parseClaudeInteraction(block.name, block.input) !== null
  )
}

function pendingUserInteractionPreview(event: { message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } }): string | null {
  const blocks = event.message?.content
  if (!Array.isArray(blocks)) return null
  for (const block of blocks) {
    if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
    const interaction = parseClaudeInteraction(block.name, block.input)
    if (!interaction) continue
    const question = interaction?.questions[0]
    if (question?.question) return `${interaction.title}：${question.question}`
    if (interaction.title) return interaction.title
  }
  return null
}

function blockText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((item) => blockText(item)).filter(Boolean).join('\n')
  }
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return blockText(record.text ?? record.content)
}

function aiTaskActivityPreview(event: {
  type?: string
  result?: unknown
  message?: { role?: string; content?: Array<{ type?: string; text?: string; thinking?: string }> }
}): string {
  if (event.type === 'result' && typeof event.result === 'string') return event.result
  if (event.type !== 'assistant' || event.message?.role !== 'assistant') return ''
  return (event.message.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

function eventHasPendingApproval(event: { message?: { content?: Array<{ type?: string; content?: unknown; is_error?: boolean }> } }): boolean {
  const blocks = event.message?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some((block) =>
    block?.type === 'tool_result'
    && block.is_error === true
    && /requires approval/i.test(blockText(block.content))
  )
}

function createAiTaskRunId(sessionId: string): string {
  const runId = `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  activeAiTaskRuns.set(sessionId, runId)
  return runId
}

function isCurrentAiTaskRun(sessionId: string, runId: string): boolean {
  return activeAiTaskRuns.get(sessionId) === runId
}

function clearAiTaskRun(sessionId: string, runId: string): void {
  if (isCurrentAiTaskRun(sessionId, runId)) {
    activeAiTaskRuns.delete(sessionId)
  }
}

function readExternalRefHints(projectPath: string): ExternalRefHint[] {
  try {
    const ctx = JSON.parse(readFileSync(join(projectPath, '.workspace', 'project-context.json'), 'utf-8'))
    const out: ExternalRefHint[] = []
    if (Array.isArray(ctx.externalRefs)) {
      pushRefsAs(out, ctx.externalRefs, 'other')
      return loadResourceInstructions(projectPath, out)
    }
    pushRefsAs(out, ctx.kbRefs, 'knowledge')
    pushRefsAs(out, ctx.uiAssets, 'uikit')
    // externalRefs 里没有重复进 kbRefs/uiAssets 的（如果 templates 哪天加新分类）
    const seen = new Set(out.map(r => r.alias))
    pushRefsAs(out, ctx.externalRefs, 'other', seen)
    return loadResourceInstructions(projectPath, out)
  } catch {
    return []
  }
}

function pushRefsAs(
  out: ExternalRefHint[],
  raw: unknown,
  category: ExternalRefHint['category'],
  seen?: Set<string>
): void {
  if (!Array.isArray(raw)) return
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const alias = typeof r.alias === 'string' ? r.alias : ''
    const path = typeof r.path === 'string' ? r.path : ''
    const kind = typeof r.kind === 'string' ? r.kind : 'unknown'
    const readonly = typeof r.readonly === 'boolean' ? r.readonly : true
    const contextCategory = r.category === 'knowledge' || r.category === 'uikit' ? r.category : category
    const instructionPath = typeof r.instructionPath === 'string' ? r.instructionPath : undefined
    const usageNote = typeof r.usageNote === 'string' ? r.usageNote : undefined
    if (!alias || !path) continue
    if (seen?.has(alias)) continue
    out.push({
      alias,
      path,
      kind,
      category: contextCategory,
      readonly,
      instructionPath,
      usageNote
    })
    seen?.add(alias)
  }
}

async function currentBranchFor(projectPath: string): Promise<string> {
  try {
    const status = await gitFor(projectPath).status()
    return status.current || 'detached'
  } catch {
    return 'detached'
  }
}

type AiTaskSubmitContext = {
  taskId?: string          // undefined ⇒ AiTaskRegistry.recordRunning 用 sessionId 派生
  workspace: Workspace
  baseWorkspace: Workspace // 简化后 = workspace，保留字段是为了 tasks.json 兼容 + notch 展示 baseWorkspaceName
  isolationBranch?: string // 不再有独立 AI 分支，永远 undefined
}

// 新模型：AI 任务不再新建 worktree/hidden workspace。用户提交 → task 直接在当前 workspace
// （其实就是当前 space 的 worktree）里跑，多 task 共用同一 cwd；tasks.json 只做跟踪单。
// 旧的 AI task hidden workspace 分支已拆掉。
async function resolveAiTaskSubmitContext(input: Workspace): Promise<AiTaskSubmitContext> {
  return {
    workspace: input,
    baseWorkspace: input
  }
}

export function claudeWorkspaceSessionKey(
  branch: string,
  targetWorkspace: ScopedTargetWorkspaceInput,
  aiProvider: AiProvider = DEFAULT_AI_PROVIDER
): string {
  const base = branchScopedWorkspaceKey(branch, targetWorkspace?.scopeKey)
  return aiProvider === 'deepseek-harness' ? `${base}|provider:${aiProvider}` : base
}

function currentAiProvider(): AiProvider {
  return settingsStore.getCached()?.aiProvider ?? DEFAULT_AI_PROVIDER
}

async function ensureAiProviderReady(provider: AiProvider): Promise<void> {
  if (provider === 'deepseek-harness' && !(await deepSeekCredentialStore.hasApiKey())) {
    throw new UIClientError(
      'DEEPSEEK_KEY_REQUIRED',
      '未配置 DeepSeek API key，请先在设置的「AI 助手」中配置'
    )
  }
}

// UI 模式按"分支 + workspace scope"保存会话。targetWorkspace.scopeKey 用来让
// 同一 space 下的多个项目任务并行跟踪；targetDocument 仍只做 prompt 聚焦，不拆 session。
async function sessionIdFor(
  projectPath: string,
  _targetDocument: TargetDocumentInput,
  targetWorkspace: ScopedTargetWorkspaceInput
): Promise<string> {
  const branch = await currentBranchFor(projectPath)
  const aiProvider = currentAiProvider()
  const scopeKey = claudeWorkspaceSessionKey(branch, targetWorkspace, aiProvider)
  const sessionId = ensureWorkspaceSessionId(projectPath, scopeKey)
  if (aiProvider === 'deepseek-harness') return sessionId
  // 死绑定自愈：EBADF 时期 forceNew 产生的空壳会话（有 id 无 jsonl）会让
  // 面板 replay 不到任何历史。同一 workDir 有真实会话时自动回填绑定。
  const workArea = await readActiveWorkArea(projectPath)
  const { workDir } = resolveClaudeLaunchContext(projectPath, workArea)
  return recoverDeadWorkspaceSessionBinding(projectPath, workDir, scopeKey) ?? sessionId
}

async function createSessionIdFor(
  projectPath: string,
  _targetDocument: TargetDocumentInput,
  targetWorkspace: ScopedTargetWorkspaceInput
): Promise<string> {
  const branch = await currentBranchFor(projectPath)
  return createWorkspaceSessionId(
    projectPath,
    claudeWorkspaceSessionKey(branch, targetWorkspace, currentAiProvider())
  )
}

export function registerClaudeHandlers(): void {
  // 后台预热能力探测（claude --help / auth status），结果缓存后供 spawn-turn 同步读取。
  // 不 await —— 不阻塞 IPC 注册；探测失败也不影响启动，spawn 时会读到保守默认值。
  if (currentAiProvider() === 'claude-code') {
    void probeClaudeCapabilities().catch((error) => {
      console.warn('[claude-handler] capability probe failed, falling back to conservative defaults:', error)
    })
  }

  // 获取或创建 session-id
  registerIpcHandler('claude.accessScope', async ({ workspaceId }) => {
    const project = await projectStore.findById(workspaceId)
    if (!project) throw new UIClientError('NOT_FOUND', '项目不存在')
    await awaitPendingWorkAreaSync(project.id)
    const launch = resolveClaudeLaunchContext(project.path, await readActiveWorkArea(project.path))
    if (currentAiProvider() === 'deepseek-harness') {
      const { readRoots, writeRoots } = await resolveHarnessAccess({ projectPath: project.path, ...launch })
      return { workDir: launch.workDir, readRoots, writeRoots, enforced: true }
    }
    const editable = readEditableRoots(project.path)
    return {
      workDir: launch.workDir,
      readRoots: [...new Set([launch.workDir, ...(getClaudeCapabilitiesSync().addDir ? launch.addDirs : [])])],
      writeRoots: editable.length ? editable.map(path => resolve(project.path, path)) : [launch.workDir],
      enforced: false
    }
  })

  registerIpcHandler('claude.sessionId', async ({ workspaceId, targetDocument, targetWorkspace }) => {
    const p = await projectStore.findById(workspaceId)
    if (!p) throw new UIClientError('NOT_FOUND', '项目不存在')
    await ensureAiProviderReady(currentAiProvider())
    await awaitPendingWorkAreaSync(p.id)
    const sessionId = await sessionIdFor(p.path, targetDocument, targetWorkspace)
    return { sessionId }
  })

  // 创建新会话：停止旧 watcher / in-flight turn，并覆盖项目当前 session-id
  registerIpcHandler('claude.session.new', async ({ workspaceId, targetDocument, targetWorkspace, abortExisting }) => {
    const p = await projectStore.findById(workspaceId)
    if (!p) throw new UIClientError('NOT_FOUND', '项目不存在')
    await ensureAiProviderReady(currentAiProvider())
    await awaitPendingWorkAreaSync(p.id)

    if (abortExisting !== false) {
      const oldSessionId = await sessionIdFor(p.path, targetDocument, targetWorkspace)
      await getAgentDriver().abort(oldSessionId)

      const watcher = activeWatchers.get(oldSessionId)
      if (watcher) {
        watcher.handle.stop()
        activeWatchers.delete(oldSessionId)
      }
      latestWatchRequests.delete(oldSessionId)
    }

    return { sessionId: await createSessionIdFor(p.path, targetDocument, targetWorkspace) }
  })

  // 提交一条消息
  registerIpcHandler('claude.submit', async ({ workspaceId, sessionId: requestedSessionId, text, chips, images, editableArea, targetDocument, targetWorkspace, toolResult, allowedTools }) => {
    const aiProvider = currentAiProvider()
    await ensureAiProviderReady(aiProvider)
    const requestedWorkspace = await projectStore.findById(workspaceId)
    if (!requestedWorkspace) throw new UIClientError('NOT_FOUND', '项目不存在')
    const submitContext = await resolveAiTaskSubmitContext(requestedWorkspace)
    const p = submitContext.workspace
    // sessionIdFor 会按 active work area 做死绑定自愈；先 drain 完整写入队列，
    // 避免用旧 cwd 选择错误会话。
    await awaitPendingWorkAreaSync(p.id)

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) throw new UIClientError('NO_WINDOW', '没有可用窗口')

    if (requestedSessionId?.trim() && !isClaudeSessionId(requestedSessionId.trim())) {
      throw new UIClientError('VALIDATION', 'Claude 会话 ID 格式无效')
    }
    const sessionId = requestedSessionId?.trim()
      || await sessionIdFor(p.path, targetDocument, targetWorkspace)
    const driver = getAgentDriver()

    // 已有 in-flight turn → 自动 abort 旧的（用户重发即视为放弃旧 turn）。
    // 必须 await 等旧子进程真退出，否则新旧 spawn 同 sessionId 同时写 jsonl 会乱。
    // 触发场景：① 前端 turnInFlight 状态对齐慢 ② 用户切视图后旧 turn 还在跑、又重发。
    if (driver.hasActiveTurn(sessionId)) {
      await driver.abort(sessionId)
    }

    const taskRunId = createAiTaskRunId(sessionId)
    diagnostics.startAiTurn({ turnId: taskRunId, sessionId, projectPath: p.path })
    let pendingSpawnLease: SpawnLease | null = null

    try {

    // 拼装 content blocks（带外挂知识库提示）
    const externalRefs = readExternalRefHints(p.path)
    const content = composeUserMessage({ text, chips, images, editableArea, targetDocument, targetWorkspace, externalRefs, toolResult })

    // zg 检索 MCP：claude-code 引擎默认挂载（stdio 代理复用常驻 daemon，开销小），
    // 工具何时调用由 AI 自主决定——MCP server 的 initialize instructions 已内置
    // 完整使用规则（语义检索优先、精确查找用原生 Grep 等）。老版本 claude 无
    // --mcp-config 时由 caps.mcpConfig 门控跳过。
    const mcpConfigPath = aiProvider === 'claude-code'
      ? await ensureZgMcpConfig() ?? undefined
      : undefined

    // 推导 spawn cwd + add-dir 白名单。targetDocument / targetWorkspace 是更细的聚焦
    // 上下文（用于 session 多粒度编址），但 cwd 仍以 workspace 级 activeWorkArea 为准。
    const workArea = await readActiveWorkArea(p.path)
    const { workDir, addDirs } = resolveClaudeLaunchContext(p.path, workArea)

    // Claude Code 的 cwd-key 是私有实现，且会随版本/长路径变化。按 SID 全局定位
    // 真实 transcript，再把绝对路径交给 --resume；不要计算后 rename JSONL。
    // 旧实现会把含 `.mywork` / 中文的路径算错并搬进错误目录，随后必然 resume 失败。
    let resumeFilePath: string | undefined
    if (aiProvider === 'claude-code') {
      resumeFilePath = findSessionJsonlForResume(workDir, sessionId) ?? undefined
    }
    const hasHistory = aiProvider === 'deepseek-harness'
      ? hasDeepSeekTranscript(sessionId)
      : resumeFilePath !== undefined
    diagnostics.markAiContextReady(taskRunId)

    const spawnLease = aiProvider === 'claude-code'
      ? await projectWatcher.acquireSpawnLease()
      : null
    if (aiProvider === 'claude-code') {
      if (!spawnLease) {
        throw new UIClientError(
          'AI_SPAWN_FAILED',
          '应用可用文件句柄不足，已暂停项目实时监听但资源尚未释放。请完全退出 App 后重新打开再试。'
        )
      }
      pendingSpawnLease = spawnLease
    }

    const taskRegistry = getSharedAiTaskRegistry()
    const { task, replaced } = await taskRegistry.recordRunningReplacingScope({
      sessionId,
      taskId: submitContext.taskId,
      workspaceId: p.id,
      workspaceName: p.name,
      workspacePath: p.path,
      baseWorkspaceId: submitContext.baseWorkspace.id,
      baseWorkspaceName: submitContext.baseWorkspace.name,
      baseWorkspacePath: submitContext.baseWorkspace.path,
      isolationBranch: submitContext.isolationBranch,
      prompt: text,
      workArea: aiTaskWorkAreaFrom(workArea, targetDocument)
    })
    for (const replacedTask of replaced) {
      if (replacedTask.sessionId === sessionId) continue
      await abortClaudeSession(replacedTask.sessionId).catch((error) => {
        console.error('[ai-task] failed to abort superseded session:', error)
      })
    }
    emitAiTaskChanged(replaced.length > 0 ? null : task)

    let handle: ReturnType<typeof driver.submit>
    try {
      handle = driver.submit({
        turnId: taskRunId,
        sessionId,
        aiProvider,
        projectPath: p.path,
        workDir,
        addDirs,
        content,
        permissionMode: 'bypassPermissions',
        allowedTools,
        mcpConfigPath,
        ownerWindowId: win.id,
        resume: hasHistory,
        resumeFilePath
      })
    } finally {
      if (spawnLease) spawnLease.release()
      pendingSpawnLease = null
    }

    let waitingStatus: 'waiting_user' | 'waiting_approval' | null = null
    handle.onEvent((event) => {
      if (!isCurrentAiTaskRun(sessionId, taskRunId)) return
      if (eventHasPendingApproval(event)) {
        waitingStatus = 'waiting_approval'
        void taskRegistry.recordActivity(sessionId, 'Claude 需要授权后才能继续执行。').catch((error) => {
          console.error('[ai-task] failed to record approval activity:', error)
        })
        void taskRegistry.markWaitingForApproval(sessionId).then(async () => {
          emitAiTaskChanged(await taskRegistry.getBySessionId(sessionId))
        }).catch((error) => {
          console.error('[ai-task] failed to mark waiting_approval:', error)
        })
        return
      }
      const interactionPreview = pendingUserInteractionPreview(event)
      if (interactionPreview || eventHasPendingUserInteraction(event)) {
        waitingStatus = 'waiting_user'
        if (interactionPreview) {
          void taskRegistry.recordActivity(sessionId, interactionPreview).catch((error) => {
            console.error('[ai-task] failed to record interaction activity:', error)
          })
        }
        void taskRegistry.markWaitingForUser(sessionId).then(async () => {
          emitAiTaskChanged(await taskRegistry.getBySessionId(sessionId))
        }).catch((error) => {
          console.error('[ai-task] failed to mark waiting_user:', error)
        })
        return
      }
      const activityPreview = aiTaskActivityPreview(event)
      if (!activityPreview) return
      void taskRegistry.recordActivity(sessionId, activityPreview).then(async () => {
        emitAiTaskChanged(await taskRegistry.getBySessionId(sessionId))
      }).catch((error) => {
        console.error('[ai-task] failed to record activity:', error)
      })
    })
    handle.onExit((code, _signal, details) => {
      if (!isCurrentAiTaskRun(sessionId, taskRunId)) return
      if (waitingStatus && code === 0) {
        const markWaiting = waitingStatus === 'waiting_approval'
          ? taskRegistry.markWaitingForApproval(sessionId)
          : taskRegistry.markWaitingForUser(sessionId)
        void markWaiting.then(async () => {
          emitAiTaskChanged(await taskRegistry.getBySessionId(sessionId))
        }).catch((error) => {
          console.error('[ai-task] failed to keep waiting status:', error)
        })
        clearAiTaskRun(sessionId, taskRunId)
        return
      }
      const status = code === 0 ? 'completed' : 'failed'
      void taskRegistry.finishSession(sessionId, {
        status,
        changedArtifacts: details?.changedArtifacts ?? [],
        errorMessage: details?.errorMessage
      }).then(async () => {
        emitAiTaskChanged(await taskRegistry.getBySessionId(sessionId))
        clearAiTaskRun(sessionId, taskRunId)
      }).catch((error) => {
        console.error('[ai-task] failed to finish task:', error)
        clearAiTaskRun(sessionId, taskRunId)
      })
    })

      return { sessionId, turnPid: handle.pid, workspaceId: p.id, taskId: task.id }
    } catch (error) {
      diagnostics.error(
        'ai.turn.prepare_failed',
        error,
        { code: 'AI_TURN_PREPARE_FAILED' },
        { turnId: taskRunId, sessionId }
      )
      diagnostics.finishAiTurn(taskRunId, 'error')
      clearAiTaskRun(sessionId, taskRunId)
      throw error
    } finally {
      if (pendingSpawnLease) pendingSpawnLease.release()
    }
  })

  // 中止当前 turn
  registerIpcHandler('claude.abort', async ({ workspaceId, sessionId: requestedSessionId, targetDocument, targetWorkspace }) => {
    const p = await projectStore.findById(workspaceId)
    if (!p) throw new UIClientError('NOT_FOUND', '项目不存在')

    const requested = requestedSessionId?.trim()
    if (requested && !isClaudeSessionId(requested)) {
      throw new UIClientError('VALIDATION', 'AI 会话 ID 格式无效')
    }
    await awaitPendingWorkAreaSync(p.id)
    const sessionId = requested || await sessionIdFor(p.path, targetDocument, targetWorkspace)
    const aborted = await abortClaudeSession(sessionId)
    if (aborted) {
      const registry = getSharedAiTaskRegistry()
      await registry.finishSession(sessionId, { status: 'aborted' })
      emitAiTaskChanged(await registry.getBySessionId(sessionId))
    }
    return { ok: aborted }
  })

  // 开始监听 JSONL（回放 + 增量）
  registerIpcHandler('claude.watch.start', async ({ workspaceId, sessionId: requestedSessionId, targetDocument, targetWorkspace }) => {
    const aiProvider = currentAiProvider()
    await ensureAiProviderReady(aiProvider)
    const requested = requestedSessionId?.trim()
    if (requested && !isClaudeSessionId(requested)) {
      throw new UIClientError('VALIDATION', 'Claude 会话 ID 格式无效')
    }
    // 显式 SID 在首个 await 前登记请求顺序，防止旧面板较慢的 findById
    // 在新面板已经启动后反向覆盖它的 watcher。
    const watchId = randomUUID()
    if (requested) latestWatchRequests.set(requested, watchId)

    const p = await projectStore.findById(workspaceId)
    if (!p) {
      if (requested && latestWatchRequests.get(requested) === watchId) {
        latestWatchRequests.delete(requested)
      }
      throw new UIClientError('NOT_FOUND', '项目不存在')
    }

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) {
      if (requested && latestWatchRequests.get(requested) === watchId) {
        latestWatchRequests.delete(requested)
      }
      throw new UIClientError('NO_WINDOW', '没有可用窗口')
    }

    await awaitPendingWorkAreaSync(workspaceId)
    const sessionId = requested
      || await sessionIdFor(p.path, targetDocument, targetWorkspace)
    const workArea = await readActiveWorkArea(p.path)
    const { workDir } = resolveClaudeLaunchContext(p.path, workArea)
    // 死绑定自愈在 sessionIdFor 内已做；work area 同步后若解析结果变了，
    // 用同步后的 workDir 再核一次，避免切换瞬间读到旧目录
    // 显式 sessionId 用于精确重连当前面板/任务，不再按 scope 暗中换会话。
    const healed = requested || aiProvider === 'deepseek-harness'
      ? null
      : recoverDeadWorkspaceSessionBinding(
        p.path,
        workDir,
        claudeWorkspaceSessionKey(await currentBranchFor(p.path), targetWorkspace, aiProvider)
      )
    const effectiveSessionId = healed ?? sessionId
    if (!requested) latestWatchRequests.set(effectiveSessionId, watchId)
    // work area 变更后 JSONL 可能仍在会话首次启动的 cwd 下。
    // 重启恢复只做读取定位，不搬文件，避免干扰仍在后台写入的 turn。
    const jsonlPath = aiProvider === 'deepseek-harness'
      ? deepSeekSessionTranscriptPath(effectiveSessionId)
      : sessionJsonlPathForReplay(workDir, effectiveSessionId)

    // 同 SID 的较新 start 已经到达时，旧请求不得反向覆盖新 watcher。
    if (latestWatchRequests.get(effectiveSessionId) !== watchId) {
      throw new UIClientError('CLAUDE_WATCH_FAILED', 'Claude 会话监听已被更新请求替代')
    }

    // 已有 watcher → 先停掉
    const existing = activeWatchers.get(effectiveSessionId)
    if (existing) existing.handle.stop()

    let replayEvents: Array<{ type: string; uuid: string; [key: string]: unknown }> = []
    const replayState: { error?: { message: string; phase: string; details?: string } } = {}
    const wh = watchJsonl(jsonlPath, {
      ownerWindowId: win.id,
      sessionId: effectiveSessionId,
      onReplay: (events) => { replayEvents = events },
      onAppend: () => { /* 同上 */ },
      onError: (error) => {
        if (error.phase === 'replay') replayState.error = error
      }
    })
    if (replayState.error) {
      wh.stop()
      throw new UIClientError('CLAUDE_WATCH_FAILED', replayState.error.message, replayState.error)
    }
    activeWatchers.set(effectiveSessionId, { watchId, handle: wh })
    return {
      sessionId: effectiveSessionId,
      watchId,
      events: replayEvents,
      turnActive: getAgentDriver().hasActiveTurn(effectiveSessionId)
    }
  })

  // 列出当前工作区可用的 skill + 内置斜杠命令，供 UI 模式 / palette 用
  registerIpcHandler('claude.commandCatalog', async ({ workspaceId }) => {
    const p = await projectStore.findById(workspaceId)
    if (!p) throw new UIClientError('NOT_FOUND', '项目不存在')
    return {
      skills: collectSkills(p.path),
      builtins: BUILTIN_SLASH_COMMANDS
    }
  })

  // 停止监听 JSONL
  registerIpcHandler('claude.watch.stop', async ({ workspaceId, sessionId: requestedSessionId, watchId, targetDocument, targetWorkspace }) => {
    const p = await projectStore.findById(workspaceId)
    if (!p) return

    await awaitPendingWorkAreaSync(p.id)
    const sessionId = requestedSessionId?.trim()
      || await sessionIdFor(p.path, targetDocument, targetWorkspace)
    const watcher = activeWatchers.get(sessionId)
    if (watcher && (!watchId || watcher.watchId === watchId)) {
      watcher.handle.stop()
      activeWatchers.delete(sessionId)
    }
    if (!watchId || latestWatchRequests.get(sessionId) === watchId) {
      latestWatchRequests.delete(sessionId)
    }
  })
}

export async function abortClaudeSession(sessionId: string): Promise<boolean> {
  const aborted = await getAgentDriver().abort(sessionId)
  if (aborted) activeAiTaskRuns.delete(sessionId)
  return aborted
}

// 内置斜杠命令清单——UI 模式 palette 显示，选中后插入到输入框（或触发 App 内置动作）。
// claude --print 模式不解析斜杠命令，所以这里都用"插入文本让用户作为 prompt 提交"的策略；
// 真正需要 App 端处理的命令（/clear /new）由 ChatComposer 自己识别 insertText 派发。
const BUILTIN_SLASH_COMMANDS: Array<{ name: string; description: string; insertText: string }> = [
  { name: '/help', description: '让 Claude 介绍当前可用 skill 和工作流', insertText: '介绍一下当前工作区可用的 skill 和它们各自的触发场景。' },
  { name: '/skills', description: '让 Claude 列出当前可用 skill 名单', insertText: '列出当前工作区所有 skill 的名字和一句话描述。' },
  { name: '/think', description: '请 Claude 多想一会儿再回复', insertText: '请深入思考再回答（think harder）。' },
  { name: '/plan', description: '不直接动手，先给出实施计划', insertText: '只规划不实施：给出步骤拆分 + 影响面 + 风险点，等我确认后再做。' },
  { name: '/new', description: 'App 动作：开始一段新对话（覆盖当前 work area 的 sessionId）', insertText: '__APP_ACTION__:new' },
  { name: '/reset', description: 'App 动作：重启 Claude Code，强制中止当前进程并解锁界面（极端卡住时使用）', insertText: '__APP_ACTION__:reset' }
]

type CommandSkill = {
  name: string
  description: string
  source: 'project' | 'user'
  quickInvocation: boolean
  defaultPrompt: string | null
}

// 扫项目与用户目录中的 .claude/.agents skills，读取斜杠菜单和快捷调用所需元数据。
function collectSkills(projectPath: string): CommandSkill[] {
  const out: CommandSkill[] = []
  pushSkillsFrom(out, join(projectPath, '.claude', 'skills'), 'project')
  pushSkillsFrom(out, join(projectPath, '.agents', 'skills'), 'project')
  pushSkillsFrom(out, join(homedir(), '.claude', 'skills'), 'user')
  pushSkillsFrom(out, join(homedir(), '.agents', 'skills'), 'user')
  return out.filter((skill, index, all) => all.findIndex((item) => item.name === skill.name) === index)
}

function pushSkillsFrom(
  out: CommandSkill[],
  dir: string,
  source: 'project' | 'user'
): void {
  if (!existsSync(dir)) return
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const skillFile = join(dir, entry, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    try {
      const raw = readFileSync(skillFile, 'utf-8')
      const meta = parseSkillFrontmatter(raw)
      if (meta.name) {
        out.push({
          name: meta.name,
          description: meta.description ?? '',
          source,
          quickInvocation: meta.quickInvocation,
          defaultPrompt: meta.defaultPrompt
        })
      }
    } catch { /* skip */ }
  }
}

function parseSkillFrontmatter(raw: string): {
  name?: string
  description?: string
  quickInvocation: boolean
  defaultPrompt: string | null
} {
  // YAML frontmatter：第一行 ---，到第二个 --- 之间。提取菜单和快捷调用需要的字段。
  // description 支持折叠风格（>-）—— 简易解析够用，复杂情况留给 fallback 显示。
  const match = /^---\s*\n([\s\S]*?)\n---/m.exec(raw)
  if (!match) return { quickInvocation: false, defaultPrompt: null }
  const block = match[1]
  const nameMatch = /^name:\s*(.+?)\s*$/m.exec(block)
  const name = nameMatch?.[1]?.trim()
  // description: 折叠成单行返回前 100 字
  const descMatch = /^description:\s*(>-\s*\n([\s\S]+?)(?:\n\w|$)|(.+?)\s*$)/m.exec(block)
  let description = (descMatch?.[2] ?? descMatch?.[3] ?? '').trim()
  description = description.replace(/\s+/g, ' ').slice(0, 120)
  const quickMatch = /^(?:quickInvocation|quick-invocation):\s*(true|false)\s*$/mi.exec(block)
  const promptMatch = /^(?:defaultPrompt|default-prompt):\s*(.+?)\s*$/m.exec(block)
  let defaultPrompt = promptMatch?.[1]?.trim() || null
  if (defaultPrompt?.startsWith('"')) {
    try {
      defaultPrompt = JSON.parse(defaultPrompt) as string
    } catch {
      defaultPrompt = defaultPrompt.replace(/^"|"$/g, '')
    }
  } else if (defaultPrompt?.startsWith("'")) {
    defaultPrompt = defaultPrompt.replace(/^'|'$/g, '')
  }
  return {
    name,
    description,
    quickInvocation: quickMatch?.[1]?.toLowerCase() === 'true',
    defaultPrompt
  }
}

// 应用退出时清理
export function cleanupClaudeResources(): void {
  void getAgentDriver().shutdown().catch((error) => {
    console.error('[claude-handler] driver shutdown failed:', error)
  })
  for (const [, watcher] of activeWatchers) { watcher.handle.stop() }
  activeWatchers.clear()
  latestWatchRequests.clear()
}
