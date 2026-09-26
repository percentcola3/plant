import { randomBytes } from 'node:crypto'
import type { GitSnapshot } from '@shared/types'
import type { GitOp, OpContext } from '../git/ops'

export type ProbeLike = {
  snapshot(workspacePath: string, defaultBranch: string, opts?: { force?: boolean }): Promise<GitSnapshot>
}
import { archiveJournal, listIncompleteJournals, writeJournal } from './journal'
import type { SagaDefinition, SagaIntent, SagaJournal, SagaStep, SagaTrigger } from './types'

// SagaRunner：把意图（save/sync/...）派发到 op 序列上，逐步执行 + 落 journal。
// 同 (workspaceId, intent) 不并发；二次 dispatch await 同一 promise（coalesce）。
// 启动时调 resumeAll 把上次崩溃 / before-quit 留下的 journal 接着跑。

export type StepHook = (journal: SagaJournal, step: SagaStep) => void

export type DispatchInput = {
  intent: SagaIntent
  workspaceId: string
  workspacePath: string
  defaultBranch: string
  args?: Record<string, unknown>
  trigger: SagaTrigger
  onStepFinish?: StepHook
}

export type SagaRunnerDeps = {
  probe: ProbeLike
  ops: Map<string, GitOp<Record<string, unknown>, unknown>>
  definitions: Map<SagaIntent, SagaDefinition>
  now?: () => Date
  newId?: (intent: SagaIntent) => string
}

function defaultNewId(intent: SagaIntent): string {
  return `${intent}-${randomBytes(6).toString('hex')}`
}

export class SagaRunner {
  private inFlight = new Map<string, Promise<SagaJournal>>()
  private now: () => Date
  private newId: (intent: SagaIntent) => string

  constructor(private deps: SagaRunnerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? defaultNewId
  }

  async dispatch(input: DispatchInput): Promise<SagaJournal> {
    const key = `${input.workspaceId}::${input.intent}`
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const promise = this.start(input).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, promise)
    return promise
  }

  // 单独保存 hook：start 与 runLoop 之间共用
  private hooks = new WeakMap<SagaJournal, StepHook>()

  async resumeAll(workspaceId: string, workspacePath: string): Promise<SagaJournal[]> {
    const journals = await listIncompleteJournals(workspacePath)
    const out: SagaJournal[] = []
    for (const j of journals) {
      if (j.workspaceId !== workspaceId) continue
      // 只续跑"上次崩溃 / before-quit 留在 running 中段"的 saga。
      // paused-for-user / paused-for-ai / failed 必须用户显式重试——不要在启动时偷偷再 dispatch
      // askpass / 推送之类有副作用的步骤。
      if (j.status !== 'running') { out.push(j); continue }
      const key = `${workspaceId}::${j.intent}`
      if (this.inFlight.has(key)) {
        out.push(await this.inFlight.get(key)!)
        continue
      }
      const promise = this.continue(j).finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, promise)
      out.push(await promise)
    }
    return out
  }

  private async start(input: DispatchInput): Promise<SagaJournal> {
    const def = this.deps.definitions.get(input.intent)
    if (!def) throw new Error(`saga definition missing: ${input.intent}`)

    const before = await this.deps.probe.snapshot(input.workspacePath, input.defaultBranch, { force: true })
    const args = input.args ?? {}
    const steps = def.buildSteps(args, before)
    const nowIso = this.now().toISOString()
    const journal: SagaJournal = {
      id: this.newId(input.intent),
      intent: input.intent,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      defaultBranch: input.defaultBranch,
      trigger: input.trigger,
      args,
      steps,
      currentStep: 0,
      status: 'running',
      snapshotBefore: before,
      snapshotAfter: before,
      createdAt: nowIso,
      lastTouchedAt: nowIso,
      schemaVersion: 1
    }
    if (input.onStepFinish) this.hooks.set(journal, input.onStepFinish)
    await writeJournal(journal)
    return this.runLoop(journal)
  }

  private async continue(journal: SagaJournal): Promise<SagaJournal> {
    journal.status = 'running'
    journal.lastTouchedAt = this.now().toISOString()
    await writeJournal(journal)
    return this.runLoop(journal)
  }

  private async runLoop(journal: SagaJournal): Promise<SagaJournal> {
    while (journal.currentStep < journal.steps.length) {
      const step = journal.steps[journal.currentStep]
      if (step.status === 'done' || step.status === 'skipped') {
        journal.currentStep += 1
        continue
      }
      const op = this.deps.ops.get(step.op)
      if (!op) {
        step.status = 'failed'
        step.failure = { kind: 'UNKNOWN', raw: `op missing: ${step.op}` }
        step.finishedAt = this.now().toISOString()
        journal.status = 'failed'
        await this.touch(journal)
        return journal
      }
      const proceed = await this.runStep(journal, step, op)
      if (!proceed) return journal
      journal.currentStep += 1
    }
    journal.status = 'done'
    await this.touch(journal)
    await archiveJournal(journal)
    return journal
  }

  private async runStep(
    journal: SagaJournal,
    step: SagaStep,
    op: GitOp<Record<string, unknown>, unknown>
  ): Promise<boolean> {
    const before = await this.deps.probe.snapshot(journal.workspacePath, journal.defaultBranch, { force: true })
    journal.snapshotAfter = before
    const ctx: OpContext = { workspacePath: journal.workspacePath, snapshot: before }

    if (op.isSatisfied(ctx, step.args)) {
      step.status = 'skipped'
      step.startedAt = this.now().toISOString()
      step.finishedAt = step.startedAt
      await this.touch(journal)
      this.hooks.get(journal)?.(journal, step)
      return true
    }

    step.status = 'running'
    step.attempts += 1
    step.startedAt = step.startedAt ?? this.now().toISOString()
    await this.touch(journal)

    let outcome
    try {
      outcome = await op.execute(ctx, step.args)
    } catch (e) {
      outcome = { ok: false as const, failure: { kind: 'UNKNOWN' as const, raw: e instanceof Error ? e.message : String(e) } }
    }

    const after = await this.deps.probe.snapshot(journal.workspacePath, journal.defaultBranch, { force: true })
    journal.snapshotAfter = after

    if (outcome.ok) {
      step.status = 'done'
      step.finishedAt = this.now().toISOString()
      delete step.failure
      await this.touch(journal)
      this.hooks.get(journal)?.(journal, step)
      return true
    }
    step.status = 'failed'
    step.failure = outcome.failure
    step.finishedAt = this.now().toISOString()
    journal.status = 'paused-for-user'
    await this.touch(journal)
    this.hooks.get(journal)?.(journal, step)
    return false
  }

  private async touch(journal: SagaJournal): Promise<void> {
    journal.lastTouchedAt = this.now().toISOString()
    await writeJournal(journal)
  }
}

export function buildOpCatalog(ops: Array<GitOp<Record<string, unknown>, unknown>>): Map<string, GitOp<Record<string, unknown>, unknown>> {
  const m = new Map<string, GitOp<Record<string, unknown>, unknown>>()
  for (const op of ops) m.set(op.name, op)
  return m
}
