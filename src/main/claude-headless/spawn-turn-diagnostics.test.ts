import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Claude turn diagnostics wiring', () => {
  const spawnSource = readFileSync(resolve(__dirname, 'spawn-turn.ts'), 'utf8')
  const handlerSource = readFileSync(resolve(__dirname, '../ipc/handlers/claude.ts'), 'utf8')

  it('does not write prompt previews into diagnostics', () => {
    expect(spawnSource).not.toContain('stdinPreview')
    expect(spawnSource).not.toContain('stdinPayload.slice(0, 600)')
    expect(spawnSource).not.toContain('home: env.HOME')
    expect(spawnSource).not.toContain('shell: env.SHELL')
  })

  it('records process, first-protocol, tool and exit milestones', () => {
    expect(spawnSource).toContain('diagnostics.markAiSpawned(turnId, { resume: !!input.resume })')
    expect(spawnSource).toContain('diagnostics.markAiFirstProtocolEvent(turnId)')
    expect(spawnSource).toContain('diagnostics.observeAiEvent(turnId, event)')
    expect(spawnSource).toContain('diagnostics.finishAiTurn(turnId, status)')
    expect(spawnSource).toMatch(/diagnostics\.error\(\s*'ai\.turn\.exit'/)
    expect(spawnSource).toContain('{ turnId, sessionId: input.sessionId }')
  })

  it('allows slow startup and reports watchdog timeouts explicitly', () => {
    expect(spawnSource).toContain('const WATCHDOG_MS = 120_000')
    expect(spawnSource).toContain('startupWatchdog.markOutputSeen()')
    expect(spawnSource).toContain('Claude Code 启动超时')
    expect(spawnSource).toContain('finishTurn(code, signal ?? undefined, startupTimeoutError)')
  })

  it('resumes from the discovered transcript path instead of a guessed cwd key', () => {
    expect(spawnSource).toMatch(/\['--resume', input\.resumeFilePath \?\? input\.sessionId\]/)
    expect(handlerSource).toContain('resumeFilePath = findSessionJsonlForResume(workDir, sessionId)')
    expect(handlerSource).not.toContain('ensureSessionJsonlAtCwd')
  })

  it('starts a turn before context preparation and passes its id to the driver', () => {
    expect(handlerSource).toContain('diagnostics.startAiTurn({')
    expect(handlerSource).toContain('diagnostics.markAiContextReady(taskRunId)')
    expect(handlerSource).toContain('turnId: taskRunId')
    expect(handlerSource).toMatch(/diagnostics\.error\(\s*'ai\.turn\.prepare_failed'/)
    expect(handlerSource).toContain("diagnostics.finishAiTurn(taskRunId, 'error')")
    expect(handlerSource).toContain('isClaudeSessionId(requestedSessionId.trim())')
  })
})
