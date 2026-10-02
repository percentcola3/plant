import { describe, expect, it } from 'vitest'
import { cliLaunchArgs, normalizeCliEvent } from './protocol'

const launch = { piSessionPath: '/sessions/plant.pi.jsonl', images: ['/tmp/image.png'], addDirs: ['/project'] }
describe('CLI launch and event protocols', () => {
  it('resumes the explicit Codex thread and passes images separately from stdin', () => {
    expect(cliLaunchArgs('codex-cli', { ...launch, nativeSessionId: 'thread-123' })).toEqual(['exec', 'resume', 'thread-123', '--json', '--skip-git-repo-check', '--image', '/tmp/image.png', '-'])
    expect(cliLaunchArgs('codex-cli', launch)).toContain('workspace-write')
  })
  it('resumes OpenCode by native session, never by the most recent global session', () => {
    expect(cliLaunchArgs('opencode-cli', { ...launch, nativeSessionId: 'ses_123' })).toEqual(['run', '--format', 'json', '--session', 'ses_123', '--file', '/tmp/image.png'])
  })
  it('uses a dedicated Pi session file and JSON print mode', () => {
    expect(cliLaunchArgs('pi-cli', launch)).toEqual(['--print', '--mode', 'json', '--session', launch.piSessionPath, '@/tmp/image.png'])
  })
  it('converts Codex command results and preserves protocol failures', () => {
    const out = normalizeCliEvent('codex-cli', { type: 'item.completed', item: { id: 'cmd1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt', status: 'completed' } })
    expect(out.events[0].message?.content[0]).toMatchObject({ type: 'tool_use', id: 'cmd1', name: 'command_execution', input: 'ls' })
    expect(out.events[1].message?.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'cmd1', content: 'a.txt' })
    expect(normalizeCliEvent('codex-cli', { type: 'turn.failed', error: { message: 'auth failed' } }).error).toBe('auth failed')
  })
  it('does not mark an OpenCode tool step as final completion', () => {
    expect(normalizeCliEvent('opencode-cli', { type: 'step_finish', part: { reason: 'tool-calls' } }).completed).toBeUndefined()
    expect(normalizeCliEvent('opencode-cli', { type: 'text', sessionID: 'ses_123', part: { text: 'done' } })).toMatchObject({ nativeSessionId: 'ses_123', events: [{ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }] })
  })
  it('uses authoritative Pi messages without duplicating deltas', () => {
    expect(normalizeCliEvent('pi-cli', { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' } }).events).toEqual([])
    expect(normalizeCliEvent('pi-cli', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'toolCall', id: 'read1', name: 'read', arguments: { path: 'a' } }] } }).events[0].message?.content).toEqual([{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 'read1', name: 'read', input: { path: 'a' } }])
    expect(normalizeCliEvent('pi-cli', { type: 'agent_end', willRetry: true }).completed).toBe(false)
  })
})
