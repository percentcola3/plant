// 每 turn spawn 一次 claude --print，解析 stream-json stdout 推送给 renderer
import { spawn, type ChildProcess } from 'node:child_process'
import { BrowserWindow } from 'electron'
import { createStartupWatchdog } from './watchdog'
import { compareArtifactSnapshots, snapshotProjectArtifacts } from './artifact-tracker'
import { resolveCliSync } from '../system/cli-resolver'
import {
  captureSpawnDiagnostics,
  describeSpawnAccess,
  describeSpawnPath,
  probeSpawnVariants,
  repairMissingStdioFds
} from '../system/spawn-health'
import { filterStderrChunk } from './stderr-filter'
import { buildSpawnEnv } from './launch-env'
import { getClaudeCapabilitiesSync } from './capability-probe'
import { createClaudeStreamHandler } from './claude-stream'
import { findOutOfScopeArtifacts, readEditableRoots } from './scope-warning'
import { diagnostics } from '../diagnostics/runtime'
import type { AiProvider } from '../../shared/ai-provider'

// stream-json 输出事件类型（claude --output-format stream-json）
export type StreamJsonEvent = {
  type: string
  subtype?: string
  session_id?: string
  uuid: string
  message?: {
    role: string
    content: Array<{
      type: string
      text?: string
      thinking?: string          // P5 thinking block（claude 扩展思考）
      name?: string
      id?: string
      input?: unknown
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
      source?: { type: string; media_type: string; data: string }
    }>
  }
  result?: string
  [key: string]: unknown
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type TurnInput = {
  turnId?: string
  sessionId: string
  aiProvider?: AiProvider                          // 缺省保持旧行为：Claude Code
  projectPath: string                           // 仓库根绝对路径，仍用于 artifact snapshot
  workDir?: string                               // claude spawn 的 cwd；缺省 = projectPath（行为不变）。
                                                 // 见 docs/.../2026-06-24-cwd-scoped-agent-design.md：
                                                 // 聚焦产物时 = outputs/<slug>/，AI 默认在子目录干活
  addDirs?: string[]                             // --add-dir 白名单。典型：projectPath + .external + skill 目录
  content: ContentBlock[]                        // 结构化 content blocks
  permissionMode: 'acceptEdits' | 'bypassPermissions' | 'default'
  ownerWindowId: number
  allowedTools?: string[]
  // zg 检索 MCP 配置文件路径：默认挂载，工具调用时机由 AI 自主决定。
  // spawn 侧还受 caps.mcpConfig 门控（老版本 claude 不支持 --mcp-config）。
  mcpConfigPath?: string
  resume?: boolean    // true = --resume；false = --session-id（首次）
  // 已找到历史时传 Claude JSONL 的真实绝对路径。Claude Code 支持按 transcript
  // 文件恢复；这比按 cwd 猜私有 project key 更可靠，也无需移动历史文件。
  resumeFilePath?: string
}

export type TurnHandle = {
  pid: number
  abort(): Promise<void>
  onEvent(cb: (event: StreamJsonEvent) => void): () => void
  onExit(cb: (
    code: number | null,
    signal?: string,
    details?: { status: 'completed' | 'error' | 'aborted'; changedArtifacts: string[]; errorMessage?: string }
  ) => void): () => void
}

const WATCHDOG_MS = 120_000
const SIGKILL_DELAY_MS = 3_000

function ebadfFriendlyError(repairedFds: number[]): Error {
  return new Error(
    '无法启动 AI 进程（spawn EBADF）：应用进程句柄异常，'
    + `已尝试自动修复（fd=${repairedFds.join(',') || '无'}）仍失败。请完全退出 App（Cmd+Q）后重新打开再试。`
  )
}

function safeSpawnDiagnosticError(code: string, phase: string): Error {
  return Object.assign(new Error(`AI process spawn failed during ${phase}: ${code || 'UNKNOWN'}`), {
    code: code || 'UNKNOWN'
  })
}

// UI 模式 --print 一次性非交互的补丁指令：需要澄清就提问并结束本轮，不自行假设往下做。
// 模型问 → 本 turn 结束 → 用户在聊天框回复 → 下一轮 --resume 带答案继续，多轮问答成立。
const ASK_AND_STOP_GUIDANCE = [
  'Clarification rule (IMPORTANT):',
  '- If you genuinely need to clarify requirements before acting, ask concise questions and STOP — end this turn without making assumptions or doing the work.',
  '- Wait for the user to reply in the next turn; do not answer your own clarifying questions or silently proceed on defaults.',
  '- Only ask when the answer materially changes your approach. For minor ambiguity, make a reasonable choice, note it briefly, and continue.'
].join('\n')

// 内部统一实现
function spawnTurnInternal(input: TurnInput): TurnHandle {
  const win = BrowserWindow.fromId(input.ownerWindowId)
  const turnId = input.turnId ?? input.sessionId
  let disposed = false
  // wasAborted = true 表示用户主动调了 abort()。区分用户主动中止 vs 进程异常退出/CLI 崩溃：
  // 前者 turn-end status='aborted'（renderer 不弹 toast），后者 status='error'。
  // watchdog 触发的 terminate 不设此标记，仍按 error 处理。
  let wasAborted = false
  let exitState: { code: number | null; signal?: string } | null = null
  const eventListeners = new Set<(e: StreamJsonEvent) => void>()
  const exitListeners = new Set<(
    code: number | null,
    sig?: string,
    details?: { status: 'completed' | 'error' | 'aborted'; changedArtifacts: string[]; errorMessage?: string }
  ) => void>()

  // 首次 turn: --session-id <uuid>；后续 turn 优先按真实 transcript 文件恢复。
  const sessionArg = input.resume
    ? ['--resume', input.resumeFilePath ?? input.sessionId]
    : ['--session-id', input.sessionId]

  // 能力探测：新版 claude（≥1.0.86）才支持 --include-partial-messages，
  // 开启后文本可逐 token 流式（P4）。老版本加这个 flag 会 "unknown option" exit 1 崩。
  // 探测在 App 启动时预热（probeClaudeCapabilities），这里同步读缓存。
  const caps = getClaudeCapabilitiesSync()

  // cwd 锁定：默认与 projectPath 一致（保持现有行为），调用方传 workDir 即切到子目录。
  // --add-dir：补足子目录 cwd 下需要的"可读窗口"——项目根 / .external / .claude/skills 等。
  // 老/fork claude 版本无 --add-dir 时跳过（caps.addDir=false）。
  const effectiveCwd = input.workDir ?? input.projectPath
  const sanitizedAddDirs = Array.from(new Set(
    (input.addDirs ?? []).filter((d): d is string => typeof d === 'string' && d.length > 0)
  ))

  const claudeArgs = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    ...(caps.partialMessages ? ['--include-partial-messages'] : []),
    ...sessionArg,
    '--permission-mode', input.permissionMode,
    // --print 是一次性非交互：模型无法中途暂停问用户，会倾向自行假设往下做。
    // 注入"问就停"指令，让模型需要澄清时结束本轮、等用户下一轮回复，多轮问答才成立。
    ...(caps.appendSystemPrompt ? ['--append-system-prompt', ASK_AND_STOP_GUIDANCE] : []),
    ...(caps.addDir && sanitizedAddDirs.length > 0 ? ['--add-dir', ...sanitizedAddDirs] : []),
    ...(input.allowedTools && input.allowedTools.length > 0 ? ['--allowedTools', ...input.allowedTools] : []),
    // zg 检索 MCP：默认挂载（配置由调用方经 ensureZgMcpConfig 生成），claude 可用
    // mcp__zvec-grep__zvec_grep_search 做语义检索，何时调用由 AI 自主决定。
    // 老版本 claude 无 --mcp-config 时由 caps.mcpConfig 门控跳过。
    ...(input.mcpConfigPath && caps.mcpConfig ? ['--mcp-config', input.mcpConfigPath] : [])
  ]
  const cli = resolveCliSync()
  const args = cli.wrapArgs(claudeArgs)

  const startedAt = Date.now()
  const artifactsBefore = snapshotProjectArtifacts(input.projectPath)
  const userEvent = {
    type: 'user',
    message: { role: 'user', content: input.content }
  }
  const stdinPayload = JSON.stringify(userEvent)
  // 优先用绝对路径；找不到时退化为命令名（依赖 PATH，不打包场景下能跑）
  const claudeBin = cli.bin
  const spawnDetached = process.platform !== 'win32'
  const spawnDiagnosticContext = () => ({
    processId: process.pid,
    cliKind: cli.kind,
    cliFound: cli.found,
    binState: describeSpawnPath(claudeBin),
    binAccess: describeSpawnAccess(claudeBin, 'executable'),
    cwdState: describeSpawnPath(effectiveCwd),
    cwdAccess: describeSpawnAccess(effectiveCwd, 'cwd'),
    spawnDetached,
    spawnStdio: 'pipe',
    ...captureSpawnDiagnostics()
  })
  const spawnCorrelation = { turnId, sessionId: input.sessionId }
  let retriedAfterEbadf = false
  let repairedFdsForRetry = ''
  let pendingProbeAfterClose: { phase: string; code: string; repairStdio: boolean } | null = null
  const scheduleSpawnProbeMatrix = (triggerPhase: string, triggerCode: string): void => {
    void probeSpawnVariants(effectiveCwd).then((probes) => {
      diagnostics.warn('ai.spawn.probe_matrix', {
        phase: triggerPhase,
        code: triggerCode,
        repairedFds: repairedFdsForRetry,
        ...probes,
        ...spawnDiagnosticContext()
      }, spawnCorrelation)
    })
  }
  diagnostics.info('ai.spawn.attempt', {
    phase: 'before-spawn',
    resume: !!input.resume,
    ...spawnDiagnosticContext()
  }, spawnCorrelation)

  let child: ChildProcess
  try {
    child = spawn(claudeBin, args, {
      cwd: effectiveCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // 合并 node/claude 目录 + 常见工具链目录进 PATH，解决 GUI 启动 PATH 不全
      // 导致 claude 子孙进程（MCP server shebang）ENOENT 的问题。
      env: buildSpawnEnv(process.env, claudeBin),
      // detached 让 claude 成为新进程组 leader（setpgid(0,0)），其所有子孙
      // （MCP server、bash、node 脚本）继承同一组 id。abort 时 process.kill(-gid)
      // 一发带走整组，杜绝孤儿进程。Windows 不支持进程组语义，回退 child.kill。
      detached: spawnDetached
    })
  } catch (error) {
    const spawnError = error as NodeJS.ErrnoException & { errno?: number | string; syscall?: string }
    const code = spawnError.code ?? ''
    diagnostics.error(
      'ai.spawn.sync_failed',
      safeSpawnDiagnosticError(code, 'initial-spawn'),
      {
        phase: 'initial-spawn',
        code,
        errno: spawnError.errno ?? '',
        syscall: spawnError.syscall ?? '',
        ...spawnDiagnosticContext()
      },
      spawnCorrelation
    )
    if (code === 'EBADF') {
      // EBADF 只证明 fd 状态异常，不直接等价于 0/1/2 失效。先修复标准 fd，
      // 随即重试真实命令；只有重试仍失败才跑探针，避免探针占用 pipe 干扰恢复。
      const repaired = repairMissingStdioFds()
      repairedFdsForRetry = repaired.join(',')
      retriedAfterEbadf = true
      diagnostics.warn('ai.spawn.repair_attempted', {
        phase: 'after-repair-before-retry',
        repairedFds: repairedFdsForRetry,
        ...spawnDiagnosticContext()
      }, spawnCorrelation)
      try {
        child = spawn(claudeBin, args, {
          cwd: effectiveCwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: buildSpawnEnv(process.env, claudeBin),
          detached: spawnDetached
        })
      } catch (retryError) {
        const retrySpawnError = retryError as NodeJS.ErrnoException & { errno?: number | string; syscall?: string }
        const retryCode = retrySpawnError.code ?? ''
        diagnostics.error(
          'ai.spawn.retry_failed',
          safeSpawnDiagnosticError(retryCode, 'retry-spawn'),
          {
            phase: 'retry-spawn',
            repairedFds: repairedFdsForRetry,
            code: retryCode,
            errno: retrySpawnError.errno ?? '',
            syscall: retrySpawnError.syscall ?? '',
            ...spawnDiagnosticContext()
          },
          spawnCorrelation
        )
        scheduleSpawnProbeMatrix('after-sync-retry-failure', retryCode)
        throw ebadfFriendlyError(repaired)
      }
      diagnostics.warn('ai.spawn.retry_returned', {
        phase: 'retry-returned',
        repairedFds: repairedFdsForRetry,
        ...spawnDiagnosticContext()
      }, spawnCorrelation)
    } else {
      throw error
    }
  }
  child.once('spawn', () => {
    diagnostics.info('ai.spawn.process_started', {
      phase: 'spawn-event',
      pidPresent: typeof child.pid === 'number',
      resume: !!input.resume
    }, spawnCorrelation)
    diagnostics.markAiSpawned(turnId, { resume: !!input.resume })
  })

  child.once('error', (error) => {
    const spawnError = error as NodeJS.ErrnoException & { errno?: number | string; syscall?: string }
    const code = spawnError.code ?? ''
    diagnostics.error(
      'ai.spawn.async_failed',
      safeSpawnDiagnosticError(code, 'async-spawn'),
      {
        phase: 'async-spawn',
        code,
        errno: spawnError.errno ?? '',
        syscall: spawnError.syscall ?? '',
        pidPresent: typeof child.pid === 'number',
        ...spawnDiagnosticContext()
      },
      spawnCorrelation
    )
    if (retriedAfterEbadf || code === 'EBADF') {
      pendingProbeAfterClose = {
        phase: 'after-async-spawn-failure',
        code,
        repairStdio: code === 'EBADF' && !retriedAfterEbadf
      }
    }
    failTurn(`Claude Code 启动失败：${error.message}`)
  })

  // 进程组 id = leader pid（仅 Unix；Windows 为 null，走 child.kill 兜底）
  const processGroupId = process.platform !== 'win32' ? child.pid : null

  // 诊断摘要不包含 stdin / prompt / 环境变量值。
  const env = process.env
  console.log('[claude-headless:diag] spawn', {
    pid: child.pid,
    sessionId: input.sessionId,
    resume: !!input.resume,
    cwd: effectiveCwd,
    projectPath: input.projectPath,
    addDirs: sanitizedAddDirs,
    bin: claudeBin,
    args,
    contentBlocks: input.content.map(b => b.type === 'image'
      ? { type: 'image', mediaType: b.source.media_type, dataBytes: b.source.data.length }
      : b.type === 'tool_result'
        ? { type: 'tool_result', toolUseId: b.tool_use_id, contentLength: b.content.length }
        : { type: b.type, textLength: b.text.length }
    ),
    envSummary: {
      hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
      claudeRelated: Object.keys(env).filter(k => k.startsWith('CLAUDE_') || k.startsWith('ANTHROPIC_')),
      pathCount: (env.PATH ?? '').split(':').length
    }
  })

  let startupTimeoutError: string | undefined

  // watchdog: 只保护启动阶段完全无 stdout 的卡死。首个 stdout 后交给用户手动停止。
  const startupWatchdog = createStartupWatchdog(WATCHDOG_MS, () => {
    if (disposed) return
    startupTimeoutError = `Claude Code 启动超时：${WATCHDOG_MS / 1000} 秒内未返回任何输出。请检查网络、登录状态或启动 Hook 后重试。`
    console.warn(`[claude-headless] startup watchdog 触发, SIGTERM pid=${child.pid}, timeoutMs=${WATCHDOG_MS}`)
    terminate()
  })
  startupWatchdog.start()

  // stream handler：role-marker 注入检测 + 预留 stream-event 增量解析（P4）
  const streamHandler = createClaudeStreamHandler()

  // 逐行解析 stdout
  let stdoutBuf = ''
  let stdoutSeen = false
  let firstEventLogged = false
  const eventTypeCounts: Record<string, number> = {}
  let stderrAcc = ''

  function finishTurn(code: number | null, signal?: string, forcedErrorMessage?: string): void {
    if (disposed) return
    startupWatchdog.stop()
    disposed = true
    exitState = { code, signal }
    // wasAborted 优先级最高：用户主动中止 → status='aborted'，不带 errorMessage
    const status: 'completed' | 'error' | 'aborted' = wasAborted
      ? 'aborted'
      : (code === 0 && !forcedErrorMessage ? 'completed' : 'error')
    const errorMessage = status === 'error'
      ? forcedErrorMessage ?? summarizeTurnError(code, signal as NodeJS.Signals | undefined, stderrAcc)
      : undefined
    if (errorMessage) {
      diagnostics.error(
        'ai.turn.exit',
        new Error(errorMessage),
        { exitCode: code ?? -1, signal: signal ?? '' },
        { turnId, sessionId: input.sessionId }
      )
    }
    diagnostics.finishAiTurn(turnId, status)
    console.log('[claude-headless:diag] exit', {
      pid: child.pid,
      sessionId: input.sessionId,
      code,
      signal,
      wasAborted,
      durationMs: Date.now() - startedAt,
      eventTypeCounts,
      stderrTail: stderrAcc.trim().slice(-400) || undefined,
      errorMessage
    })
    const changedArtifacts = readChangedArtifacts(input.projectPath, artifactsBefore)
    const editableRoots = readEditableRoots(input.projectPath)
    const outOfScopeArtifacts = findOutOfScopeArtifacts(changedArtifacts, editableRoots)
    for (const cb of exitListeners) {
      try { cb(code, signal, { status, changedArtifacts, errorMessage }) } catch (error) {
        console.error('[claude-headless] exit listener failed:', error)
      }
    }
    try {
      win?.webContents.send(`claude.turn-end:${input.sessionId}`, {
        status,
        exitCode: code,
        changedArtifacts,
        outOfScopeArtifacts,
        editableRoots,
        errorMessage
      })
    } catch (error) {
      console.error('[claude-headless] turn-end send failed:', error)
    }
  }

  function failTurn(message: string): void {
    stderrAcc += `\n${message}`
    console.error(`[claude-headless] ${message}`)
    finishTurn(null, undefined, message)
  }

  child.stdin?.on('error', (error) => {
    const code = (error as NodeJS.ErrnoException).code
    // EPIPE(Unix) / EOF(Windows) = claude 提前关了 stdin 读端（fast-exit 场景：
    // bad auth / 缺 model / 启动即崩）。此时真实失败已由 exit/close handler 经
    // stderr 报上来，这里吞掉避免双重报错 + 状态翻转。其他 stdin 错误仍 failTurn。
    if (code === 'EPIPE' || code === 'EOF' || error.message === 'write EOF') return
    failTurn(`Claude Code 输入失败：${error.message}`)
  })

  child.stdout?.on('error', (error) => {
    failTurn(`Claude Code 输出读取失败：${error.message}`)
  })

  child.stderr?.on('error', (error) => {
    failTurn(`Claude Code 错误输出读取失败：${error.message}`)
  })

  try {
    child.stdin?.write(stdinPayload + '\n')
    child.stdin?.end()
  } catch (error) {
    failTurn(`Claude Code 输入失败：${error instanceof Error ? error.message : String(error)}`)
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    if (disposed) return
    if (!stdoutSeen && chunk.length > 0) {
      stdoutSeen = true
      startupWatchdog.markOutputSeen()
    }
    stdoutBuf += chunk.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as StreamJsonEvent
        if (!firstEventLogged) {
          firstEventLogged = true
          diagnostics.markAiFirstProtocolEvent(turnId)
          console.log('[claude-headless:diag] first stdout event', {
            pid: child.pid,
            type: event.type,
            subtype: event.subtype,
            elapsedMs: Date.now() - startedAt
          })
        }
        eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1
        diagnostics.observeAiEvent(turnId, event)

        // 喂 stream handler：检测 role-marker 注入等威胁信号；raw 事件透传走原 IPC
        for (const derived of streamHandler.handle(event)) {
          if (derived.type === 'role_marker_detected') {
            console.error(`[claude-headless] 检测到伪造角色标记 ## ${derived.marker}，中止以防对话劫持`)
            failTurn(`检测到伪造的角色标记（## ${derived.marker}），已中止以防对话被劫持`)
            return   // 已 failTurn，跳过本行后续推送
          }
          // raw 事件 → 原路径
          if (derived.type === 'raw') {
            for (const cb of eventListeners) cb(derived.event)
            win?.webContents.send(`claude.delta:${input.sessionId}`, derived.event)
          }
        }
      } catch {
        diagnostics.warn('ai.stream.non_json', { inputBytes: Buffer.byteLength(line) })
        console.warn('[claude-headless] 跳过非 JSON 行')
      }
    }
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    // stderrAcc 保留原始内容（失败诊断 summarizeTurnError 需要完整 stderr 尾部，
    // 不能过滤丢掉真实错误行）。只对实时 console.warn 做噪声过滤，避免日志被
    // telemetry / MCP handshake / node 弃用警告淹没。
    stderrAcc += text
    const visible = filterStderrChunk(text).trim()
    if (visible) console.warn(`[claude-headless] stderr: ${visible.slice(0, 200)}`)
  })

  // 子进程真正退出（close 事件已触发）的 promise，给 abort 用 await 等死透。
  // 不等的话 driver 在 hasActiveTurn=false 之后立刻 spawn 新 turn，新旧子进程
  // 同一 sessionId 同时写 jsonl 会乱。
  let resolveClosed: () => void = () => {}
  const closedPromise = new Promise<void>(resolve => { resolveClosed = resolve })
  child.on('close', (code, signal) => {
    const pendingProbe = pendingProbeAfterClose
    pendingProbeAfterClose = null
    if (pendingProbe?.repairStdio) {
      repairedFdsForRetry = repairMissingStdioFds().join(',')
      diagnostics.warn('ai.spawn.async_repair_attempted', {
        phase: 'after-async-ebadf-close',
        repairedFds: repairedFdsForRetry,
        ...spawnDiagnosticContext()
      }, spawnCorrelation)
    }
    if (pendingProbe) scheduleSpawnProbeMatrix(pendingProbe.phase, pendingProbe.code)
    finishTurn(code, signal ?? undefined, startupTimeoutError)
    resolveClosed()
  })

  // 向 claude 进程组发信号（负号 pid）。Unix 下 detached spawn 让 claude 成为
  // 组 leader，其子孙（MCP server / bash）同组，一发全收，杜绝孤儿进程。
  // ESRCH = 组已不在，静默；其他 errno 回退直接 child.kill。
  function signalProcessGroup(signal: NodeJS.Signals): boolean {
    if (process.platform === 'win32' || !processGroupId) return false
    try {
      process.kill(-processGroupId, signal)
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // ESRCH = 进程组已不存在（claude 已退出），静默；其他异常记日志但仍算失败
      if (code !== 'ESRCH') {
        console.warn(`[claude-headless] signal ${signal} group ${processGroupId} failed: ${code}`)
      }
      return false
    }
  }

  function terminate() {
    if (disposed) return
    // 优先进程组 kill；失败或 Windows 回退直接 child.kill
    if (!signalProcessGroup('SIGTERM')) {
      try { child.kill('SIGTERM') } catch { /* already dead */ }
    }
    setTimeout(() => {
      if (!signalProcessGroup('SIGKILL')) {
        try { child.kill('SIGKILL') } catch { /* already dead */ }
      }
    }, SIGKILL_DELAY_MS)
  }

  return {
    get pid() { return child.pid ?? -1 },
    abort: async () => {
      wasAborted = true
      terminate()
      // 等子进程真死。SIGTERM 通常 <1s 内退出；最多 SIGKILL_DELAY_MS（3s）后被 SIGKILL 兜底。
      await closedPromise
    },
    onEvent(cb) { eventListeners.add(cb); return () => { eventListeners.delete(cb) } },
    onExit(cb) {
      if (exitState) {
        cb(exitState.code, exitState.signal)
        return () => {}
      }
      exitListeners.add(cb)
      return () => { exitListeners.delete(cb) }
    }
  }
}

function readChangedArtifacts(
  projectPath: string,
  before: ReturnType<typeof snapshotProjectArtifacts>
): string[] {
  try {
    return compareArtifactSnapshots(before, snapshotProjectArtifacts(projectPath))
  } catch (error) {
    console.error('[claude-headless] artifact snapshot failed:', error)
    return []
  }
}

function summarizeTurnError(code: number | null, signal: NodeJS.Signals | undefined, stderr: string): string {
  const reason = signal ? `Claude Code 被 ${signal} 终止` : `Claude Code 退出码 ${code ?? '未知'}`
  const tail = stderr
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-4)
    .join('\n')
  return tail ? `${reason}\n${tail}` : reason
}

// 首次 turn（新 session）
export function spawnTurn(input: TurnInput): TurnHandle {
  return spawnTurnInternal({ ...input, resume: false })
}

// 后续 turn（resume 已有 session）
export function spawnResumeTurn(input: TurnInput): TurnHandle {
  return spawnTurnInternal({ ...input, resume: true })
}
