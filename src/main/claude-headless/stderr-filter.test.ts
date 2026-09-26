import { describe, expect, it } from 'vitest'
import { filterStderrChunk, createStderrFilter } from './stderr-filter'

describe('stderr-filter', () => {
  it('suppresses telemetry / MCP handshake / node warnings', () => {
    const raw = [
      '[telemetry] sending batch',
      '[MCP] server figma connected',
      'ExperimentalWarning: --experimental-fetch',
      'DeprecationWarning: punycode module is deprecated',
      ''
    ].join('\n')
    expect(filterStderrChunk(raw).trim()).toBe('')
  })

  it('keeps lines containing error/fatal/failed even if they match a suppressed pattern', () => {
    const raw = '[MCP] server figma failed to start: invalid token'
    // 含 failed → 即使命中 [MCP] 模式也保留
    expect(filterStderrChunk(raw)).toContain('failed to start')
  })

  it('keeps genuine errors and stack traces untouched', () => {
    const raw = [
      'Error: Cannot find module foo',
      '    at Object.<anonymous> (index.js:1)',
      'FATAL: auth token expired'
    ].join('\n')
    expect(filterStderrChunk(raw)).toBe(raw)
  })

  it('createStderrFilter accumulates across writes and flushes tail', () => {
    const f = createStderrFilter()
    const out1 = f.write('[telemetry] x\nError: boom\n')
    expect(out1).toContain('Error: boom')
    expect(out1).not.toContain('telemetry')
    const out2 = f.flush()
    expect(out2).toBe('')
  })
})
