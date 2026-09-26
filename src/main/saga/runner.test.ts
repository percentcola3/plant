import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitSnapshot } from '@shared/types'

const tmpUserData = await mkdtemp(join(tmpdir(), 'saga-runner-userdata-'))
vi.mock('electron', () => ({ app: { getPath: () => tmpUserData } }))

import { SagaRunner, buildOpCatalog, type ProbeLike } from './runner'
import type { GitOp, OpContext, OpOutcome } from '../git/ops'
import type { SagaDefinition, SagaJournal, SagaStep } from './types'
import { sagasDir, sagasDoneDir } from './paths'

let workspacePath: string
let workspaceId: string
let snapshotSeq: number

function buildSnapshot(over: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    workspacePath,
    branch: 'req/x',
    defaultBranch: 'main',
    working: { kind: 'clean' },
    remote: { kind: 'tracked', outgoing: 0, incoming: 0 },
    mainlineIncoming: 0,
    headSha: `sha-${++snapshotSeq}`,
    takenAt: snapshotSeq,
    ...over
  }
}

function makeProbe(seq: GitSnapshot[]): ProbeLike {
  let i = 0
  return {
    async snapshot() {
      const s = seq[Math.min(i, seq.length - 1)]
      i += 1
      return s
    }
  }
}

function makeOp(name: string, behavior: {
  satisfied?: (ctx: OpContext, args: Record<string, unknown>) => boolean
  outcome?: OpOutcome | (() => OpOutcome)
} = {}): GitOp<Record<string, unknown>, unknown> & { calls: number } {
  let calls = 0
  const op: GitOp<Record<string, unknown>, unknown> & { calls: number } = {
    name,
    idempotent: true,
    isSatisfied: behavior.satisfied ?? (() => false),
    async execute(): Promise<OpOutcome> {
      calls += 1
      op.calls = calls
      const o = typeof behavior.outcome === 'function' ? behavior.outcome() : behavior.outcome
      return o ?? { ok: true, data: undefined }
    },
    calls: 0
  }
  return op
}

const trivialSteps = (ops: string[]): SagaStep[] => ops.map((op) => ({
  op, args: {}, status: 'pending', attempts: 0
}))

const buildDef = (intent: 'save' | 'sync', stepNames: string[]): SagaDefinition => ({
  intent,
  buildSteps: () => trivialSteps(stepNames)
})

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'saga-ws-'))
  workspaceId = `ws-${Math.random().toString(36).slice(2, 8)}`
  snapshotSeq = 0
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined)
})

async function readSagaFile(id: string): Promise<SagaJournal | null> {
  const path = join(sagasDir(workspacePath), `${id}.json`)
  try { return JSON.parse(await readFile(path, 'utf-8')) as SagaJournal } catch { return null }
}

async function readDoneFile(id: string): Promise<SagaJournal | null> {
  const path = join(sagasDoneDir(workspacePath), `${id}.json`)
  try { return JSON.parse(await readFile(path, 'utf-8')) as SagaJournal } catch { return null }
}

describe('SagaRunner.dispatch', () => {
  it('runs every step, archives journal on success', async () => {
    const opA = makeOp('a')
    const opB = makeOp('b')
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA, opB]),
      definitions: new Map([['save', buildDef('save', ['a', 'b'])]])
    })
    const j = await runner.dispatch({
      intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user'
    })
    expect(j.status).toBe('done')
    expect(j.steps.map((s) => s.status)).toEqual(['done', 'done'])
    expect(opA.calls).toBe(1)
    expect(opB.calls).toBe(1)

    expect(await readSagaFile(j.id)).toBeNull()
    const archived = await readDoneFile(j.id)
    expect(archived?.status).toBe('done')
  })

  it('skips step when isSatisfied returns true', async () => {
    const opA = makeOp('a', { satisfied: () => true })
    const opB = makeOp('b')
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA, opB]),
      definitions: new Map([['save', buildDef('save', ['a', 'b'])]])
    })
    const j = await runner.dispatch({
      intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user'
    })
    expect(j.status).toBe('done')
    expect(j.steps[0].status).toBe('skipped')
    expect(j.steps[1].status).toBe('done')
    expect(opA.calls).toBe(0)
    expect(opB.calls).toBe(1)
  })

  it('pauses for user when a step fails', async () => {
    const opA = makeOp('a')
    const opB = makeOp('b', {
      outcome: { ok: false, failure: { kind: 'NON_FAST_FORWARD' } }
    })
    const opC = makeOp('c')
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA, opB, opC]),
      definitions: new Map([['save', buildDef('save', ['a', 'b', 'c'])]])
    })
    const j = await runner.dispatch({
      intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user'
    })
    expect(j.status).toBe('paused-for-user')
    expect(j.currentStep).toBe(1)
    expect(j.steps[1].status).toBe('failed')
    expect(j.steps[1].failure).toEqual({ kind: 'NON_FAST_FORWARD' })
    expect(j.steps[2].status).toBe('pending')
    expect(opC.calls).toBe(0)

    // journal kept on disk (not archived) when paused
    const onDisk = await readSagaFile(j.id)
    expect(onDisk?.status).toBe('paused-for-user')
  })

  it('marks failed when op missing from catalog', async () => {
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([]),
      definitions: new Map([['save', buildDef('save', ['ghost'])]])
    })
    const j = await runner.dispatch({
      intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user'
    })
    expect(j.status).toBe('failed')
    expect(j.steps[0].failure).toEqual({ kind: 'UNKNOWN', raw: 'op missing: ghost' })
  })

  it('coalesces concurrent dispatch of same intent', async () => {
    let executed = 0
    const opA: GitOp<Record<string, unknown>, unknown> = {
      name: 'a', idempotent: true,
      isSatisfied: () => false,
      async execute() {
        executed += 1
        await new Promise((r) => setTimeout(r, 30))
        return { ok: true, data: undefined }
      }
    }
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA]),
      definitions: new Map([['save', buildDef('save', ['a'])]])
    })
    const [j1, j2] = await Promise.all([
      runner.dispatch({ intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user' }),
      runner.dispatch({ intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user' })
    ])
    expect(j1).toBe(j2)
    expect(executed).toBe(1)
  })
})

describe('SagaRunner.resumeAll', () => {
  it('does NOT auto-resume paused-for-user journals (用户须手动重试)', async () => {
    const opA = makeOp('a')
    const opB = makeOp('b', { outcome: { ok: false, failure: { kind: 'NON_FAST_FORWARD' } } })
    const opC = makeOp('c')
    const runner1 = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA, opB, opC]),
      definitions: new Map([['save', buildDef('save', ['a', 'b', 'c'])]])
    })
    const first = await runner1.dispatch({
      intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user'
    })
    expect(first.status).toBe('paused-for-user')

    const opC2 = makeOp('c')
    const runner2 = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA, opB, opC2]),
      definitions: new Map([['save', buildDef('save', ['a', 'b', 'c'])]])
    })
    const resumed = await runner2.resumeAll(workspaceId, workspacePath)
    // journal 仍然返回（让上层知道有未完成 saga），但状态保持 paused-for-user，op 不再被调用
    expect(resumed).toHaveLength(1)
    expect(resumed[0].status).toBe('paused-for-user')
    expect(opC2.calls).toBe(0)
  })

  it('skips journals from other workspaces', async () => {
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([makeOp('a')]),
      definitions: new Map([['save', buildDef('save', ['a'])]])
    })
    const resumed = await runner.resumeAll(workspaceId, workspacePath)
    expect(resumed).toEqual([])
  })

  it('does resume journals stuck in running state (例如 before-quit / 崩溃中段)', async () => {
    // 制造一份"running 中段"journal：手动写盘
    const opA = makeOp('a')
    const opB = makeOp('b')
    const journalDir = sagasDir(workspacePath)
    await import('node:fs/promises').then((m) => m.mkdir(journalDir, { recursive: true }))
    const stuck: SagaJournal = {
      id: 'save-stuck',
      intent: 'save',
      workspaceId,
      workspacePath,
      defaultBranch: 'main',
      trigger: 'before-quit',
      args: {},
      steps: [
        { op: 'a', args: {}, status: 'done', attempts: 1 },
        { op: 'b', args: {}, status: 'pending', attempts: 0 }
      ],
      currentStep: 1,
      status: 'running',
      snapshotBefore: buildSnapshot(),
      snapshotAfter: buildSnapshot(),
      createdAt: '2026-06-13T00:00:00Z',
      lastTouchedAt: '2026-06-13T00:00:01Z',
      schemaVersion: 1
    }
    await import('node:fs/promises').then((m) => m.writeFile(
      join(journalDir, `${stuck.id}.json`),
      JSON.stringify(stuck)
    ))

    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA, opB]),
      definitions: new Map([['save', buildDef('save', ['a', 'b'])]])
    })
    const resumed = await runner.resumeAll(workspaceId, workspacePath)
    expect(resumed[0].status).toBe('done')
    expect(opA.calls).toBe(0)            // 已 done 不重跑
    expect(opB.calls).toBe(1)            // pending 步重跑
  })
})

describe('SagaRunner journal — durability', () => {
  it('writes journal before each op runs (visible to crash-mid-step)', async () => {
    let captured: SagaJournal | null = null
    const opA: GitOp<Record<string, unknown>, unknown> = {
      name: 'a', idempotent: true,
      isSatisfied: () => false,
      async execute() {
        // 模拟"步骤运行中崩溃"场景：在 op 执行的瞬间读 journal
        const dir = await readdir(sagasDir(workspacePath))
        const file = dir.find((n) => n.endsWith('.json'))
        if (file) {
          const path = join(sagasDir(workspacePath), file)
          captured = JSON.parse(await readFile(path, 'utf-8')) as SagaJournal
        }
        return { ok: true, data: undefined }
      }
    }
    const runner = new SagaRunner({
      probe: makeProbe([buildSnapshot()]),
      ops: buildOpCatalog([opA]),
      definitions: new Map([['save', buildDef('save', ['a'])]])
    })
    await runner.dispatch({
      intent: 'save', workspaceId, workspacePath, defaultBranch: 'main', trigger: 'user'
    })
    expect(captured).not.toBeNull()
    const c = captured as unknown as SagaJournal
    expect(c.steps[0].status).toBe('running')
    expect(c.steps[0].attempts).toBe(1)
  })
})
