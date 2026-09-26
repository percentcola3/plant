import { gitForWithAskpass } from '../client'
import { classifyError } from '../failures'
import type { GitOp, OpContext, OpOutcome } from './types'

// 当前分支落后远端时 rebase 拉取。无 upstream / 已对齐 / 工作树异常态都直接跳过或失败。
export const pullRebaseOp: GitOp = {
  name: 'pull-rebase',
  idempotent: true,
  isSatisfied(ctx: OpContext) {
    const r = ctx.snapshot.remote
    if (r.kind === 'no-remote' || r.kind === 'untracked-local') return true
    return r.incoming === 0
  },
  async execute(ctx): Promise<OpOutcome> {
    const r = ctx.snapshot.remote
    if (r.kind === 'no-remote' || r.kind === 'untracked-local') return { ok: true, data: undefined }
    if (r.incoming === 0) return { ok: true, data: undefined }

    const w = ctx.snapshot.working
    if (w.kind !== 'clean') {
      // 不在 dirty 之外的异常态尝试 pull-rebase 风险大，直接拒绝
      if (w.kind === 'rebasing') return { ok: false, failure: { kind: 'REBASE_IN_PROGRESS' } }
      if (w.kind === 'detached') return { ok: false, failure: { kind: 'DETACHED' } }
      if (w.kind === 'dirty') return { ok: false, failure: { kind: 'UNCOMMITTED', files: w.files.map((f) => f.path) } }
      return { ok: false, failure: { kind: 'CONFLICT', files: w.conflicts, during: w.kind === 'merging' ? 'merge' : w.kind === 'cherry-picking' ? 'cherry-pick' : 'revert' } }
    }

    try {
      const sg = await gitForWithAskpass(ctx.workspacePath)
      await sg.pull('origin', ctx.snapshot.branch, ['--rebase'])
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'rebase' }) }
    }
  }
}
