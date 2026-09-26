import { describe, expect, it } from 'vitest'
import { redactText, sanitizeAttributes, serializeDiagnosticError } from './redact'

describe('diagnostic redaction', () => {
  it('removes credentials and user home paths from text', () => {
    const value = redactText(
      'token=secret-value Authorization: Bearer abc123 sk-ant-api03-secret /Users/alice/work/repo'
    )

    expect(value).not.toContain('secret-value')
    expect(value).not.toContain('abc123')
    expect(value).not.toContain('sk-ant-api03-secret')
    expect(value).not.toContain('/Users/alice')
    expect(value).toContain('~/work/repo')
  })

  it('keeps only diagnostic attribute keys and primitive values', () => {
    expect(sanitizeAttributes({
      prompt: 'private request',
      command: 'rm -rf private',
      bin: '/Users/alice/.local/bin/claude',
      cwd: '/Users/alice/private-project',
      toolName: 'Read',
      durationMs: 42,
      success: true,
      phase: 'before-spawn',
      binAccess: 'ok',
      cwdAccess: 'ok',
      fdCount: 38,
      fdBaselineCount: 20,
      fdDeltaFromBaseline: 18,
      fdHighWater: 38,
      fdNext: 41,
      fdNextCode: 'ok',
      fdScanCode: 'ok',
      fdSocketCount: 12,
      fdScanTruncated: false,
      stderrFdState: 'valid:fifo',
      stderrStreamState: 'tty=0,destroyed=0,closed=0',
      activeResources: 'PipeWrap:3,ProcessWrap:1',
      probePipeDetached: 'EBADF',
      epipeCount: 3,
      lastEpipeAgoMs: 12,
      isPackaged: true,
      pidPresent: false,
      repairedFds: '2',
      nested: { private: true }
    })).toEqual({
      toolName: 'Read',
      durationMs: 42,
      success: true,
      phase: 'before-spawn',
      binAccess: 'ok',
      cwdAccess: 'ok',
      fdCount: 38,
      fdBaselineCount: 20,
      fdDeltaFromBaseline: 18,
      fdHighWater: 38,
      fdNext: 41,
      fdNextCode: 'ok',
      fdScanCode: 'ok',
      fdSocketCount: 12,
      fdScanTruncated: false,
      stderrFdState: 'valid:fifo',
      stderrStreamState: 'tty=0,destroyed=0,closed=0',
      activeResources: 'PipeWrap:3,ProcessWrap:1',
      probePipeDetached: 'EBADF',
      epipeCount: 3,
      lastEpipeAgoMs: 12,
      isPackaged: true,
      pidPresent: false,
      repairedFds: '2'
    })
  })

  it('serializes errors without retaining credential values', () => {
    const error = new Error('request failed token=secret-value')
    error.stack = 'Error: token=secret-value\n    at /Users/alice/work/app.ts:10:2'

    const serialized = serializeDiagnosticError(error)

    expect(serialized.name).toBe('Error')
    expect(serialized.message).not.toContain('secret-value')
    expect(serialized.stack).not.toContain('/Users/alice')
  })
})
