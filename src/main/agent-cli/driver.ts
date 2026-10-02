import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { BrowserWindow } from 'electron'
import type { AgentDriver } from '../claude-headless/driver/types'
import type { StreamJsonEvent, TurnHandle, TurnInput } from '../claude-headless/spawn-turn'
import { isCliAiProvider } from '../../shared/ai-provider'
import { findCommandAsync } from '../system/find-command'
import { buildSpawnEnv } from '../claude-headless/launch-env'
import { snapshotProjectArtifacts, compareArtifactSnapshots } from '../claude-headless/artifact-tracker'
import { readEditableRoots, findOutOfScopeArtifacts } from '../claude-headless/scope-warning'
import { diagnostics } from '../diagnostics/runtime'
import { appendCliEvent, cliNativeSessionId, cliTranscriptPath } from './transcript'
import { CLI_COMMANDS, cliLaunchArgs, normalizeCliEvent } from './protocol'

export class CliAgentDriver implements AgentDriver {
  private readonly active = new Map<string, TurnHandle>()
  submit(input: TurnInput): TurnHandle {
    const provider = input.aiProvider
    if (!isCliAiProvider(provider)) throw new Error('Unsupported CLI provider')
    if (this.active.has(input.sessionId)) throw new Error('会话已有进行中的任务')
    const eventListeners = new Set<Parameters<TurnHandle['onEvent']>[0]>()
    const exitListeners = new Set<Parameters<TurnHandle['onExit']>[0]>()
    const turnId = input.turnId ?? input.sessionId
    const win = BrowserWindow.fromId(input.ownerWindowId)
    const before = snapshotProjectArtifacts(input.projectPath)
    let child: ChildProcess | undefined
    let aborted = false
    let finished = false
    let errorMessage = ''
    let nativeCompleted = false
    let lastText = ''
    let tempDir: string | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let exitState: Parameters<Parameters<TurnHandle['onExit']>[0]> | undefined
    let resolveDone!: () => void
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const emit = (event: StreamJsonEvent) => {
      appendCliEvent(input.sessionId, event)
      diagnostics.observeAiEvent(turnId, event)
      for (const cb of eventListeners) cb(event)
      if (!win?.isDestroyed()) win?.webContents.send(`claude.delta:${input.sessionId}`, event)
    }
    const finish = (code: number | null, signal?: string) => {
      if (finished) return
      finished = true
      clearTimeout(killTimer); clearTimeout(watchdog)
      const status: 'aborted' | 'completed' | 'error' = aborted ? 'aborted' : code === 0 && nativeCompleted && !errorMessage ? 'completed' : 'error'
      if (status === 'error' && !errorMessage) errorMessage = `${CLI_COMMANDS[provider]} 未正常完成（退出码 ${code ?? signal ?? '未知'}）`
      let changedArtifacts: string[] = []
      try { changedArtifacts = compareArtifactSnapshots(before, snapshotProjectArtifacts(input.projectPath)) } catch { /* optional snapshot */ }
      const editableRoots = readEditableRoots(input.projectPath)
      const details = { status, changedArtifacts, ...(errorMessage ? { errorMessage } : {}) }
      exitState = [code, signal, details]
      try {
        emit({ type: 'result', uuid: randomUUID(), subtype: status === 'completed' ? 'success' : 'error', result: status === 'completed' ? lastText : errorMessage, is_error: status === 'error' })
        diagnostics.finishAiTurn(turnId, status)
        if (!win?.isDestroyed()) win?.webContents.send(`claude.turn-end:${input.sessionId}`, { ...details, exitCode: code, editableRoots, outOfScopeArtifacts: findOutOfScopeArtifacts(changedArtifacts, editableRoots) })
      } catch (error) {
        console.error('[agent-cli] failed to publish turn completion:', error)
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true })
        this.active.delete(input.sessionId)
        resolveDone()
        for (const cb of exitListeners) cb(code, signal, details)
      }
    }
    const terminate = () => {
      if (!child?.pid) return
      const kill = (signal: NodeJS.Signals) => {
        try { if (process.platform === 'win32') child?.kill(signal); else process.kill(-child!.pid!, signal) } catch { /* already exited */ }
      }
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 3000)
    }
    const handle: TurnHandle = {
      get pid() { return child?.pid ?? 0 },
      async abort() { if (finished) return; aborted = true; terminate(); await done },
      onEvent(cb) { eventListeners.add(cb); return () => { eventListeners.delete(cb) } },
      onExit(cb) { if (exitState) cb(...exitState); else exitListeners.add(cb); return () => { exitListeners.delete(cb) } }
    }
    this.active.set(input.sessionId, handle)
    queueMicrotask(() => { void (async () => {
      try {
        const bin = await findCommandAsync(CLI_COMMANDS[provider])
        if (aborted) { finish(null, 'SIGTERM'); return }
        if (!bin) throw new Error(`未找到 ${CLI_COMMANDS[provider]}，请先安装并在终端完成登录或模型配置。`)
        const nativeSessionId = cliNativeSessionId(input.sessionId)
        const images: string[] = []
        for (const block of input.content) {
          if (block.type !== 'image') continue
          tempDir ??= mkdtempSync(join(tmpdir(), 'plant-agent-'))
          const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[block.source.media_type]
          if (!ext) throw new Error(`不支持的图片格式：${block.source.media_type}`)
          const path = join(tempDir, `${images.length}.${ext}`)
          writeFileSync(path, Buffer.from(block.source.data, 'base64'), { mode: 0o600 }); images.push(path)
        }
        const piSessionPath = join(dirname(cliTranscriptPath(input.sessionId)), `${input.sessionId}.pi.jsonl`)
        mkdirSync(dirname(piSessionPath), { recursive: true })
        const args = cliLaunchArgs(provider, { nativeSessionId, piSessionPath, images, addDirs: input.addDirs ?? [] })
        child = spawn(bin, args, { cwd: input.workDir ?? input.projectPath, env: buildSpawnEnv({ ...process.env, ...(provider === 'opencode-cli' && input.permissionMode === 'bypassPermissions' ? { OPENCODE_PERMISSION: JSON.stringify({ '*': 'allow' }) } : {}) }, bin), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
        diagnostics.markAiSpawned(turnId, { resume: !!nativeSessionId })
        emit({ type: 'user', uuid: randomUUID(), message: { role: 'user', content: input.content } })
        let pending = '', stderr = ''
        const consume = (line: string) => {
          if (!line.trim()) return
          const normalized = normalizeCliEvent(provider, JSON.parse(line))
          if (normalized.nativeSessionId) emit({ type: 'system', uuid: randomUUID(), nativeSessionId: normalized.nativeSessionId, aiProvider: provider })
          if (normalized.error) errorMessage = normalized.error
          if (normalized.completed) nativeCompleted = true
          for (const event of normalized.events) {
            const text = event.message?.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
            if (event.type === 'assistant' && text) lastText = text
            emit(event)
          }
        }
        watchdog = setTimeout(() => { errorMessage = 'AI 启动超时：120 秒内未返回输出，请检查 CLI 登录和网络。'; terminate() }, 120000)
        child.stdout!.setEncoding('utf8')
        child.stdout!.on('data', (chunk: string) => {
          clearTimeout(watchdog)
          pending += chunk
          let boundary: number
          try { while ((boundary = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1); consume(line) } }
          catch (error) { errorMessage = `CLI 输出解析失败：${(error as Error).message}`; terminate() }
        })
        child.stderr!.setEncoding('utf8')
        child.stderr!.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
        child.on('error', error => { errorMessage = `${CLI_COMMANDS[provider]} 启动失败：${error.message}`; finish(1) })
        child.on('close', (code, signal) => {
          try { if (pending.trim()) consume(pending) } catch (error) { errorMessage ||= (error as Error).message }
          if (code !== 0) errorMessage ||= stderr.trim()
          finish(code, signal ?? undefined)
        })
        for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', error => { errorMessage = `CLI 输入输出失败：${error.message}`; terminate() })
        const prompt = input.content.map(b => b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : '').filter(Boolean).join('\n\n')
        child.stdin!.end(prompt)
      } catch (error) { errorMessage = (error as Error).message; if (child?.pid) terminate(); else finish(1) }
    })() })
    return handle
  }
  async abort(sessionId: string): Promise<boolean> { const handle = this.active.get(sessionId); if (!handle) return false; await handle.abort(); return true }
  hasActiveTurn(sessionId: string): boolean { return this.active.has(sessionId) }
  async shutdown(): Promise<void> { await Promise.all([...this.active.values()].map(handle => handle.abort())) }
}
