import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null
  }
}))

import { claudeWorkspaceSessionKey } from './claude'

const source = readFileSync(new URL('./claude.ts', import.meta.url), 'utf8')

describe('claude workspace session scope', () => {
  it('separates two work-area tasks in the same personal space without changing workspace id', () => {
    const first = claudeWorkspaceSessionKey('space/b', {
      kind: 'workspace-home',
      scopeKey: 'ui-product:outputs/project-1'
    })
    const second = claudeWorkspaceSessionKey('space/b', {
      kind: 'workspace-home',
      scopeKey: 'ui-product:outputs/project-2'
    })

    expect(first).toBe('branch:space/b|workspace:ui-product:outputs/project-1')
    expect(second).toBe('branch:space/b|workspace:ui-product:outputs/project-2')
    expect(second).not.toBe(first)
  })

  it('keeps the home conversation on the branch home scope', () => {
    expect(claudeWorkspaceSessionKey('space/b', { kind: 'workspace-home' }))
      .toBe('branch:space/b|workspace:home')
  })

  it('keeps DeepSeek history separate from Claude Code on the same scope', () => {
    expect(claudeWorkspaceSessionKey(
      'space/b',
      { kind: 'workspace-home' },
      'deepseek-harness'
    )).toBe('branch:space/b|workspace:home|provider:deepseek-harness')
  })

  it('isolates each CLI history on the same workspace scope', () => {
    const keys = (['claude-code', 'deepseek-harness', 'codex-cli', 'opencode-cli', 'pi-cli'] as const)
      .map(provider => claudeWorkspaceSessionKey('space/b', { kind: 'workspace-home' }, provider))
    expect(new Set(keys).size).toBe(5)
    expect(keys[2]).toBe('branch:space/b|workspace:home|provider:codex-cli')
  })

  it('aborts superseded sessions when a new task replaces the same project scope', () => {
    expect(source).toContain('recordRunningReplacingScope')
    expect(source).toContain('for (const replacedTask of replaced)')
    expect(source).toContain('abortClaudeSession(replacedTask.sessionId)')
  })

  it('holds the watcher spawn lease from preflight through the synchronous spawn', () => {
    const headroomCheck = source.indexOf('await projectWatcher.acquireSpawnLease()')
    const recordRunning = source.indexOf('recordRunningReplacingScope')
    const submit = source.indexOf('driver.submit({')
    const release = source.indexOf('spawnLease.release()', submit)

    expect(headroomCheck).toBeGreaterThan(-1)
    expect(headroomCheck).toBeLessThan(recordRunning)
    expect(headroomCheck).toBeLessThan(submit)
    expect(release).toBeGreaterThan(submit)
  })
})
