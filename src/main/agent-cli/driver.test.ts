import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ spawn: vi.fn(), find: vi.fn(), append: vi.fn(), native: vi.fn(), send: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: state.spawn }))
vi.mock('electron', () => ({ BrowserWindow: { fromId: () => ({ isDestroyed: () => false, webContents: { send: state.send } }) } }))
vi.mock('../system/find-command', () => ({ findCommandAsync: state.find }))
vi.mock('./transcript', () => ({ appendCliEvent: state.append, cliNativeSessionId: state.native, cliTranscriptPath: () => '/tmp/plant-cli-driver-test/test.jsonl' }))
vi.mock('../claude-headless/artifact-tracker', () => ({ snapshotProjectArtifacts: () => new Map(), compareArtifactSnapshots: () => [] }))
vi.mock('../claude-headless/scope-warning', () => ({ readEditableRoots: () => [], findOutOfScopeArtifacts: () => [] }))
vi.mock('../diagnostics/runtime', () => ({ diagnostics: { observeAiEvent: vi.fn(), markAiSpawned: vi.fn(), finishAiTurn: vi.fn() } }))
import { CliAgentDriver } from './driver'
import type { TurnInput } from '../claude-headless/spawn-turn'
const input: TurnInput = { aiProvider: 'codex-cli', sessionId: 'plant-session', projectPath: '/tmp', ownerWindowId: 1, content: [{ type: 'text', text: 'hello' }], permissionMode: 'default' }
function processDouble() {
  return Object.assign(new EventEmitter(), { pid: undefined, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
}
beforeEach(() => { vi.clearAllMocks(); state.find.mockResolvedValue('/bin/codex'); state.native.mockReturnValue(undefined) })
describe('CLI driver lifecycle', () => {
  it('frames chunked JSONL and persists a native ID for exact resume', async () => {
    const child = processDouble(); state.spawn.mockReturnValue(child)
    const driver = new CliAgentDriver(); const handle = driver.submit(input); const exit = vi.fn(); handle.onExit(exit)
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled())
    child.stdout.write('{"type":"thread.started","thread_id":"native-1"}\n{"type":"item.comp')
    child.stdout.write('leted","item":{"type":"agent_message","text":"hello\u2028world"}}\n{"type":"turn.completed"}')
    child.emit('close', 0, null)
    expect(exit).toHaveBeenCalledWith(0, undefined, expect.objectContaining({ status: 'completed' }))
    expect(state.append).toHaveBeenCalledWith(input.sessionId, expect.objectContaining({ nativeSessionId: 'native-1' }))
    expect(driver.hasActiveTurn(input.sessionId)).toBe(false)
  })
  it('reports protocol failures even with zero process exit code', async () => {
    const child = processDouble(); state.spawn.mockReturnValue(child)
    const handle = new CliAgentDriver().submit(input); const exit = vi.fn(); handle.onExit(exit)
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled())
    child.stdout.write('{"type":"turn.failed","error":{"message":"login required"}}\n')
    child.emit('close', 0, null)
    expect(exit).toHaveBeenCalledWith(0, undefined, expect.objectContaining({ status: 'error', errorMessage: 'login required' }))
  })
  it('aborts while binary discovery is pending without launching a process', async () => {
    let resolve!: (bin: string) => void; state.find.mockReturnValue(new Promise<string>(r => { resolve = r }))
    const driver = new CliAgentDriver(); const handle = driver.submit(input); const exit = vi.fn(); handle.onExit(exit)
    await vi.waitFor(() => expect(state.find).toHaveBeenCalled())
    const stopped = handle.abort(); resolve('/bin/codex'); await stopped
    expect(state.spawn).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(null, 'SIGTERM', expect.objectContaining({ status: 'aborted' }))
  })
  it('releases missing executable failures and delivers late exit subscribers', async () => {
    state.find.mockResolvedValue(null)
    const driver = new CliAgentDriver(); const handle = driver.submit(input)
    await vi.waitFor(() => expect(driver.hasActiveTurn(input.sessionId)).toBe(false))
    const exit = vi.fn(); handle.onExit(exit)
    expect(exit).toHaveBeenCalledWith(1, undefined, expect.objectContaining({ status: 'error' }))
  })
})
