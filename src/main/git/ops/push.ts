import { pushWithSummary, type PushHookResult } from '../push-with-summary'
import { gitForWithAskpass } from '../client'
import { classifyError } from '../failures'
import { getSharedProbe } from '../probe'
import type { GitOp, OpContext, OpOutcome } from './types'

export type PushArgs = {
  /** 本地 ref，默认当前分支 */
  source?: string
  /** 远端分支名，默认当前分支 */
  branch?: string
  /** 覆盖是否 -u。不传则仅 untracked-local 设上游 */
  setUpstream?: boolean
  /** 覆盖是否 --force-with-lease。不传则仅已跟踪的非主分支 force */
  forceWithLease?: boolean
}

type PushPlan = {
  branch: string
  source: string
  setUpstream: boolean
  forceWithLease: boolean
}

function resolvePushPlan(ctx: OpContext, args: PushArgs = {}): PushPlan {
  const r = ctx.snapshot.remote
  const branch = args.branch ?? ctx.snapshot.branch
  const source = args.source ?? branch
  const isMain = branch === ctx.snapshot.defaultBranch
  return {
    branch,
    source,
    setUpstream: args.setUpstream ?? r.kind === 'untracked-local',
    forceWithLease: args.forceWithLease ?? (r.kind !== 'untracked-local' && !isMain)
  }
}

// 推送策略由 op 内部决定（可被 args 覆盖）：
// - no-remote        → 跳过（成功）
// - untracked-local  → push -u origin <branch>
// - tracked + main   → 普通 push（main 分支不允许 force）
// - tracked + 非 main → push --force-with-lease（容忍 squash 改 sha，又防覆盖他人）
export const pushOp: GitOp<PushArgs, PushHookResult> = {
  name: 'push',
  idempotent: true,
  isSatisfied(ctx: OpContext, args = {}) {
    const r = ctx.snapshot.remote
    if (r.kind === 'no-remote') return true
    if (args.source || (args.branch && args.branch !== ctx.snapshot.branch)) return false
    if (r.kind === 'untracked-local') return false
    return r.outgoing === 0
  },
  async execute(ctx, args = {}): Promise<OpOutcome<PushHookResult>> {
    const r = ctx.snapshot.remote
    if (r.kind === 'no-remote') return { ok: true, data: {} }

    const plan = resolvePushPlan(ctx, args)

    try {
      const sg = await gitForWithAskpass(ctx.workspacePath)
      const data = await pushWithSummary(sg, ctx.workspacePath, {
        branch: plan.branch,
        source: plan.source,
        setUpstream: plan.setUpstream,
        forceWithLease: plan.forceWithLease
      })
      return { ok: true, data }
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'push', branch: plan.branch }) }
    }
  }
}

export async function runPushOp(
  workspacePath: string,
  defaultBranch: string,
  args: PushArgs = {}
): Promise<OpOutcome<PushHookResult>> {
  const probe = getSharedProbe()
  probe.invalidate(workspacePath)
  const snapshot = await probe.snapshot(workspacePath, defaultBranch, { force: true })
  const outcome = await pushOp.execute({ workspacePath, snapshot }, args)
  probe.invalidate(workspacePath)
  return outcome
}
