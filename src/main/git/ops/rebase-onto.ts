import { gitFor } from '../client'
import { classifyError } from '../failures'
import type { GitOp, OpContext, OpOutcome } from './types'

export type RebaseOntoArgs = { onto: string }

// 把当前分支 rebase 到 args.onto（如 'origin/main'）。
// - 若 onto 是 origin/<defaultBranch> 且 mainlineIncoming === 0 即视为已满足
// - working 必须 clean；否则返回 UNCOMMITTED 让 saga 决定先 commit
export const rebaseOntoOp: GitOp<RebaseOntoArgs> = {
  name: 'rebase-onto',
  idempotent: true,
  isSatisfied(ctx: OpContext, args: RebaseOntoArgs) {
    const expected = `origin/${ctx.snapshot.defaultBranch}`
    if (args.onto === expected && ctx.snapshot.mainlineIncoming === 0) return true
    return false
  },
  async execute(ctx, args): Promise<OpOutcome> {
    const w = ctx.snapshot.working
    if (w.kind === 'rebasing') return { ok: false, failure: { kind: 'REBASE_IN_PROGRESS' } }
    if (w.kind !== 'clean') {
      const files = w.kind === 'dirty' ? w.files.map((f) => f.path) : []
      return { ok: false, failure: { kind: 'UNCOMMITTED', files } }
    }

    const sg = gitFor(ctx.workspacePath)
    try {
      await sg.raw(['rev-parse', '--verify', args.onto])
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'rebase', branch: args.onto }) }
    }
    try {
      await sg.rebase([args.onto])
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'rebase' }) }
    }
  }
}
