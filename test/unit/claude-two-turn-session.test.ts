import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const testState = vi.hoisted(() => ({
  homePath: '',
  projectPath: ''
}))
const registerIpcHandlerMock = vi.hoisted(() => vi.fn())
const driverSubmitMock = vi.hoisted(() => vi.fn())
const driverHasActiveTurnMock = vi.hoisted(() => vi.fn(() => false))
const findWorkspaceMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'workspace-1',
  kind: 'project',
  name: 'Demo',
  path: testState.projectPath,
  defaultBranch: 'main',
  addedAt: '2026-08-18T00:00:00.000Z',
  lastActiveAt: '2026-08-18T00:00:00.000Z'
})))
const recordRunningMock = vi.hoisted(() => vi.fn(async () => ({
  task: { id: 'task-1' },
  replaced: []
})))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => testState.homePath }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => ({ id: 7 }),
    getAllWindows: () => [],
    fromId: () => null
  }
}))

vi.mock('../../src/main/ipc/registry', () => ({
  registerIpcHandler: registerIpcHandlerMock
}))

vi.mock('../../src/main/workspaces/store', () => ({
  WorkspacesStore: class {
    findById = findWorkspaceMock
  }
}))

vi.mock('../../src/main/claude-headless/driver', () => ({
  getAgentDriver: () => ({
    submit: driverSubmitMock,
    hasActiveTurn: driverHasActiveTurnMock,
    abort: vi.fn(async () => false),
    shutdown: vi.fn(async () => undefined)
  })
}))

vi.mock('../../src/main/claude-headless/capability-probe', () => ({
  probeClaudeCapabilities: vi.fn(async () => undefined)
}))

vi.mock('../../src/main/claude-headless/launch-context', () => ({
  resolveClaudeLaunchContext: () => ({
    workDir: testState.projectPath,
    addDirs: []
  })
}))

vi.mock('../../src/main/workspaces/service', () => ({
  awaitPendingWorkAreaSync: vi.fn(async () => undefined)
}))

vi.mock('../../src/main/workspaces/work-area', () => ({
  readActiveWorkArea: vi.fn(async () => null)
}))

vi.mock('../../src/main/projects/watcher', () => ({
  projectWatcher: {
    acquireSpawnLease: vi.fn(async () => ({ release: vi.fn() }))
  }
}))

vi.mock('../../src/main/git/client', () => ({
  gitFor: () => ({
    status: vi.fn(async () => ({ current: 'main' }))
  })
}))

vi.mock('../../src/main/ai-tasks/service', () => ({
  getSharedAiTaskRegistry: () => ({
    recordRunningReplacingScope: recordRunningMock,
    recordActivity: vi.fn(async () => undefined),
    markWaitingForApproval: vi.fn(async () => undefined),
    markWaitingForUser: vi.fn(async () => undefined),
    finishSession: vi.fn(async () => undefined),
    getBySessionId: vi.fn(async () => null)
  })
}))

vi.mock('../../src/main/ai-tasks/notch-window', () => ({
  presentAiTaskNotch: vi.fn()
}))

vi.mock('../../src/main/diagnostics/runtime', () => ({
  diagnostics: {
    startAiTurn: vi.fn(),
    markAiContextReady: vi.fn(),
    error: vi.fn(),
    finishAiTurn: vi.fn()
  }
}))

import { registerClaudeHandlers } from '../../src/main/ipc/handlers/claude'
import { sessionJsonlPath } from '../../src/main/claude-headless/session-id'
import { useConversationStore } from '../../src/renderer/src/stores/conversation'

type SubmitHandler = (input: {
  workspaceId: string
  text: string
}) => Promise<{ sessionId: string }>
type SessionIdHandler = (input: {
  workspaceId: string
}) => Promise<{ sessionId: string }>
type WatchStartHandler = (input: {
  workspaceId: string
  sessionId: string
}) => Promise<{
  sessionId: string
  watchId: string
  events: typeof firstTurnEvents
}>
type WatchStopHandler = (input: {
  workspaceId: string
  sessionId: string
  watchId?: string
}) => Promise<void>

const firstTurnEvents = [
  {
    type: 'user',
    uuid: 'user-1',
    message: { role: 'user', content: [{ type: 'text', text: '第一个问题' }] }
  },
  {
    type: 'assistant',
    uuid: 'assistant-1',
    message: { role: 'assistant', content: [{ type: 'text', text: '第一个回答' }] }
  }
]

function registeredHandler<T>(channel: string): T {
  const entry = registerIpcHandlerMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel)
  expect(entry).toBeTruthy()
  return entry![1] as T
}

function registerHandlers(): void {
  registerClaudeHandlers()
}

beforeEach(async () => {
  testState.homePath = await mkdtemp(join(tmpdir(), 'ui-client-two-turn-home-'))
  testState.projectPath = await mkdtemp(join(tmpdir(), 'ui-client-two-turn-project-'))
  setActivePinia(createPinia())
  registerIpcHandlerMock.mockClear()
  driverSubmitMock.mockReset()
  driverHasActiveTurnMock.mockClear()
  findWorkspaceMock.mockClear()
  recordRunningMock.mockClear()

  driverSubmitMock.mockImplementation((input: { sessionId: string; workDir: string }) => {
    if (driverSubmitMock.mock.calls.length === 1) {
      const path = sessionJsonlPath(input.workDir, input.sessionId)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, firstTurnEvents.map(event => JSON.stringify(event)).join('\n') + '\n', 'utf-8')
    }
    return {
      pid: 123,
      onEvent: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      abort: vi.fn(async () => undefined)
    }
  })
})

afterEach(async () => {
  await rm(testState.homePath, { recursive: true, force: true })
  await rm(testState.projectPath, { recursive: true, force: true })
})

describe('claude.submit conversation continuity', () => {
  it('keeps one session across two normal turns, resumes the second, and preserves earlier messages', async () => {
    registerHandlers()
    const submit = registeredHandler<SubmitHandler>('claude.submit')
    const first = await submit({ workspaceId: 'workspace-1', text: '第一个问题' })

    const store = useConversationStore()
    store.setActiveSession(first.sessionId)
    store.replay(first.sessionId, firstTurnEvents)
    store.endTurn(first.sessionId, 'completed')
    store.beginTurn(first.sessionId, '第二个问题')

    const second = await submit({ workspaceId: 'workspace-1', text: '第二个问题' })

    expect(second.sessionId).toBe(first.sessionId)
    expect(driverSubmitMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: first.sessionId,
      resume: false
    }))
    expect(driverSubmitMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: first.sessionId,
      resume: true,
      resumeFilePath: sessionJsonlPath(testState.projectPath, first.sessionId)
    }))
    expect(store.activeSessionId).toBe(first.sessionId)
    expect(store.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text))
      .toEqual(['第一个问题', '第一个回答', '第二个问题'])
  })

  it('resumes the discovered transcript by absolute path without relocating it', async () => {
    registerHandlers()
    const submit = registeredHandler<SubmitHandler>('claude.submit')
    const first = await submit({ workspaceId: 'workspace-1', text: '第一个问题' })
    const calculatedPath = sessionJsonlPath(testState.projectPath, first.sessionId)
    const privateDir = join(testState.homePath, '.claude', 'projects', 'private-cwd-key-vNext')
    const actualPath = join(privateDir, `${first.sessionId}.jsonl`)
    mkdirSync(privateDir, { recursive: true })
    renameSync(calculatedPath, actualPath)

    await submit({ workspaceId: 'workspace-1', text: '第二个问题' })

    expect(driverSubmitMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: first.sessionId,
      resume: true,
      resumeFilePath: actualPath
    }))
    expect(existsSync(actualPath)).toBe(true)
    expect(existsSync(calculatedPath)).toBe(false)
  })

  it('restores the persisted session and history through the real watch.start handler', async () => {
    registerHandlers()
    const submit = registeredHandler<SubmitHandler>('claude.submit')
    const sessionId = registeredHandler<SessionIdHandler>('claude.sessionId')
    const watchStart = registeredHandler<WatchStartHandler>('claude.watch.start')
    const watchStop = registeredHandler<WatchStopHandler>('claude.watch.stop')

    const first = await submit({ workspaceId: 'workspace-1', text: '第一个问题' })

    // Fresh Pinia represents a newly created renderer after restarting the app.
    setActivePinia(createPinia())
    const restored = await sessionId({ workspaceId: 'workspace-1' })
    const watched = await watchStart({
      workspaceId: 'workspace-1',
      sessionId: restored.sessionId
    })

    try {
      const store = useConversationStore()
      store.setActiveSession(watched.sessionId)
      store.replay(watched.sessionId, watched.events, { historical: true })

      expect(restored.sessionId).toBe(first.sessionId)
      expect(watched.sessionId).toBe(first.sessionId)
      expect(watched.events.map(event => event.uuid)).toEqual(['user-1', 'assistant-1'])
      expect(store.messages.flatMap(message => message.content)
        .filter(block => block.type === 'text')
        .map(block => block.text))
        .toEqual(['以下为上次会话历史', '第一个问题', '第一个回答'])
    } finally {
      await watchStop({ workspaceId: 'workspace-1', sessionId: watched.sessionId })
    }
  })

  it('does not let an older delayed watch.start replace the latest panel watcher', async () => {
    registerHandlers()
    const submit = registeredHandler<SubmitHandler>('claude.submit')
    const watchStart = registeredHandler<WatchStartHandler>('claude.watch.start')
    const watchStop = registeredHandler<WatchStopHandler>('claude.watch.stop')
    const first = await submit({ workspaceId: 'workspace-1', text: '第一个问题' })
    const workspace = {
      id: 'workspace-1',
      kind: 'project' as const,
      name: 'Demo',
      path: testState.projectPath,
      defaultBranch: 'main',
      addedAt: '2026-08-18T00:00:00.000Z',
      lastActiveAt: '2026-08-18T00:00:00.000Z'
    }
    let releaseOldLookup!: () => void
    const oldLookup = new Promise<typeof workspace>((resolve) => {
      releaseOldLookup = () => resolve(workspace)
    })
    findWorkspaceMock
      .mockImplementationOnce(() => oldLookup)
      .mockImplementationOnce(async () => workspace)

    const oldStart = watchStart({ workspaceId: workspace.id, sessionId: first.sessionId })
    const latest = await watchStart({ workspaceId: workspace.id, sessionId: first.sessionId })
    releaseOldLookup()

    await expect(oldStart).rejects.toMatchObject({ code: 'CLAUDE_WATCH_FAILED' })
    expect(latest.sessionId).toBe(first.sessionId)
    expect(latest.watchId).toMatch(/^[0-9a-f-]{36}$/i)
    await watchStop({
      workspaceId: workspace.id,
      sessionId: latest.sessionId,
      watchId: latest.watchId
    })
  })
})
