import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/main/ipc/handlers/claude.ts'),
  'utf-8'
)

describe('claude headless session history path', () => {
  it('resumes the discovered transcript and uses launch cwd only as the watcher fallback', () => {
    expect(source).toContain('resumeFilePath = findSessionJsonlForResume(workDir, sessionId)')
    expect(source).toContain('resumeFilePath')
    expect(source).toContain('sessionJsonlPathForReplay(workDir, effectiveSessionId)')
    expect(source).not.toContain('ensureSessionJsonlAtCwd')
  })

  it('reuses the persisted scope session when submit does not provide an explicit id', () => {
    expect(source).toContain('|| await sessionIdFor(p.path, targetDocument, targetWorkspace)')
    expect(source).not.toContain('|| await createSessionIdFor(p.path, targetDocument, targetWorkspace)')
  })

  it('returns the effective watched session id to keep renderer subscriptions aligned', () => {
    expect(source).toContain('sessionId: effectiveSessionId,')
  })
})
