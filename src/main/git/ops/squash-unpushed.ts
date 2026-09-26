import { gitFor } from '../client'
import { classifyError } from '../failures'
import type { GitOp, OpContext, OpOutcome } from './types'

export type SquashArgs = { message: string }

// 把当前分支领先远端的所有 commit squash 成一笔有意义的版本 commit。
// 已 push 的 commit 不在 outgoing 范围内，由 git 自身保证不被 rewrite。
// 适用于"打版本"saga 的中间步骤；要求工作树干净（commit op 在它之前完成）。
export const squashUnpushedOp: GitOp<SquashArgs> = {
  name: 'squash-unpushed',
  idempotent: true,
  isSatisfied(ctx: OpContext) {
    // 只看 tracked 的 outgoing；untracked-local / no-remote 让 execute 算一次实际数量
    return ctx.snapshot.remote.kind === 'tracked' && ctx.snapshot.remote.outgoing === 0
  },
  async execute(ctx, args): Promise<OpOutcome> {
    if (ctx.snapshot.working.kind !== 'clean') {
      // squash 前必须 commit；上层 saga 应当保证顺序。这里防御性返回 UNCOMMITTED。
      const files = ctx.snapshot.working.kind === 'dirty' ? ctx.snapshot.working.files.map((f) => f.path) : []
      return { ok: false, failure: { kind: 'UNCOMMITTED', files } }
    }
    const msg = args.message.trim()
    if (!msg) return { ok: false, failure: { kind: 'UNKNOWN', raw: 'squash message empty' } }

    const sg = gitFor(ctx.workspacePath)
    const count = await readUnpushedCount(ctx)
    if (count === 0) return { ok: true, data: undefined }
    try {
      if (count === 1) {
        await sg.raw(['commit', '--amend', '-m', msg])
      } else {
        await sg.raw(['reset', '--soft', `HEAD~${count}`])
        await sg.raw(['commit', '-m', msg])
      }
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'commit' }) }
    }
  }
}

// tracked 用 snapshot.outgoing；untracked-local / no-remote 用 defaultBranch..branch 算。
async function readUnpushedCount(ctx: OpContext): Promise<number> {
  const r = ctx.snapshot.remote
  if (r.kind === 'tracked') return r.outgoing
  if (r.kind === 'no-remote' || r.kind === 'untracked-local') {
    if (ctx.snapshot.branch === ctx.snapshot.defaultBranch) return 0
    try {
      const out = await gitFor(ctx.workspacePath).raw([
        'rev-list',
        '--count',
        `${ctx.snapshot.defaultBranch}..${ctx.snapshot.branch}`
      ])
      return parseInt(out.trim(), 10) || 0
    } catch {
      return 0
    }
  }
  return 0
}
