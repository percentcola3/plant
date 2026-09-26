import { describe, expect, it } from 'vitest'
import { createDiagnosticsService, type DiagnosticEntry } from './service'

describe('diagnostics service', () => {
  it('writes structured events with whitelisted attributes', () => {
    const entries: DiagnosticEntry[] = []
    const service = createDiagnosticsService({ now: () => 1_000, write: (entry) => entries.push(entry) })

    service.info('app.started', { appVersion: '0.2.2', prompt: 'private request' })

    expect(entries).toEqual([{
      timestamp: new Date(1_000).toISOString(),
      level: 'info',
      category: 'app',
      event: 'app.started',
      attributes: { appVersion: '0.2.2' }
    }])
  })

  it('keeps turn correlation on informational spawn diagnostics', () => {
    const entries: DiagnosticEntry[] = []
    const service = createDiagnosticsService({ now: () => 1_000, write: (entry) => entries.push(entry) })

    service.info(
      'ai.spawn.attempt',
      { phase: 'before-spawn', fdCount: 24 },
      { turnId: 'turn-1', sessionId: 'session-1' }
    )

    expect(entries[0]).toMatchObject({
      turnId: 'turn-1',
      sessionId: 'session-1',
      attributes: { phase: 'before-spawn', fdCount: 24 }
    })
  })

  it('redacts unsafe correlation ids and keeps them on errors', () => {
    const entries: DiagnosticEntry[] = []
    const service = createDiagnosticsService({ now: () => 1_000, write: (entry) => entries.push(entry) })

    service.error(
      'ai.turn.failure',
      new Error('failed'),
      { code: 'FAILED' },
      { turnId: 'turn-token=secret', sessionId: '/Users/alice/private request' }
    )

    expect(entries[0].turnId).toBe('[REDACTED]')
    expect(entries[0].sessionId).toBe('[REDACTED]')
    expect(JSON.stringify(entries)).not.toMatch(/secret|alice|private request/)
  })

  it('separates protocol, assistant and visible-text milestones', () => {
    const entries: DiagnosticEntry[] = []
    const times = [100, 120, 130, 140, 180, 230, 250, 280, 300]
    const service = createDiagnosticsService({ now: () => times.shift()!, write: (entry) => entries.push(entry) })

    service.startAiTurn({ turnId: 'turn-1', sessionId: 'session-1', projectPath: '/repo' })
    service.markAiContextReady('turn-1')
    service.markAiSpawned('turn-1', { resume: true })
    service.markAiFirstProtocolEvent('turn-1')
    service.observeAiEvent('turn-1', {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/.external/kb/doc.md' } }]
      }
    })
    service.observeAiEvent('turn-1', {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'private file content', is_error: false }]
      }
    })
    service.observeAiEvent('turn-1', {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Visible answer' }] }
    })
    service.observeAiEvent('turn-1', {
      type: 'result',
      duration_ms: 150,
      duration_api_ms: 90,
      num_turns: 3,
      usage: { input_tokens: 1200, output_tokens: 300 }
    })
    service.finishAiTurn('turn-1', 'completed')

    expect(entries.find((entry) => entry.event === 'ai.turn.context_ready')).toMatchObject({ durationMs: 20 })
    expect(entries.find((entry) => entry.event === 'ai.turn.first_protocol_event')).toMatchObject({ durationMs: 40 })
    expect(entries.find((entry) => entry.event === 'ai.turn.first_assistant')).toMatchObject({ durationMs: 80 })
    expect(entries.find((entry) => entry.event === 'ai.turn.first_visible_text')).toMatchObject({ durationMs: 150 })
    expect(entries.find((entry) => entry.event === 'ai.tool.finished')).toMatchObject({
      durationMs: 50,
      status: 'completed',
      attributes: {
        toolName: 'Read',
        toolCategory: 'knowledge_retrieval',
        relativePath: '.external/kb/doc.md',
        success: true,
        inputBytes: 41,
        outputBytes: 20
      }
    })
    expect(entries.find((entry) => entry.event === 'ai.turn.summary')).toMatchObject({
      durationMs: 200,
      status: 'completed',
      attributes: {
        appPrepareMs: 30,
        firstProtocolMs: 40,
        firstAssistantMs: 80,
        firstVisibleTextMs: 150,
        claudeDurationMs: 150,
        apiDurationMs: 90,
        retrievalCount: 1,
        retrievalWallMs: 50,
        knowledgeRetrievalCount: 1,
        codeRetrievalCount: 0,
        writeCount: 0,
        numTurns: 3,
        inputTokens: 1200,
        outputTokens: 300,
        resume: true
      }
    })
    expect(entries.at(-1)).toMatchObject({
      event: 'ai.turn.finished',
      durationMs: 200,
      status: 'completed'
    })
    expect(JSON.stringify(entries)).not.toContain('private file content')
  })

  it('classifies Bash searches without logging command content', () => {
    const entries: DiagnosticEntry[] = []
    const times = [100, 110, 160, 200]
    const service = createDiagnosticsService({ now: () => times.shift()!, write: (entry) => entries.push(entry) })

    service.startAiTurn({ turnId: 'turn-1', sessionId: 'session-1', projectPath: '/repo' })
    service.observeAiEvent('turn-1', {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'rg -li "private business term" .external/knowledge' }
        }]
      }
    })
    service.observeAiEvent('turn-1', {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '', is_error: false }] }
    })
    service.finishAiTurn('turn-1', 'completed')

    expect(entries.find((entry) => entry.event === 'ai.tool.started')).toMatchObject({
      attributes: { toolName: 'Bash', toolCategory: 'knowledge_retrieval' }
    })
    expect(entries.find((entry) => entry.event === 'ai.turn.summary')).toMatchObject({
      attributes: {
        retrievalCount: 1,
        retrievalWallMs: 50,
        knowledgeRetrievalCount: 1
      }
    })
    expect(JSON.stringify(entries)).not.toContain('private business term')
  })

  it('does not fail when a tool result never arrives', () => {
    const service = createDiagnosticsService({ now: () => 100, write: () => undefined })
    service.startAiTurn({ turnId: 'turn-1', sessionId: 'session-1', projectPath: '/repo' })
    service.observeAiEvent('turn-1', {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Grep', input: { path: '/repo/src' } }] }
    })

    expect(() => service.finishAiTurn('turn-1', 'error')).not.toThrow()
  })
})
