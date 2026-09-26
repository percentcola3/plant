import { gitForWithAskpass } from '../client'
import { classifyError } from '../failures'
import type { GitOp, OpContext, OpOutcome } from './types'

// fetch 没有"已完成"语义——每次调用都可能发现新远端 commit。
// idempotent=true 表示重入安全（不改本地工作树），但 isSatisfied=false 让 runner 总是真跑。
export const fetchOp: GitOp = {
  name: 'fetch',
  idempotent: true,
  isSatisfied(ctx: OpContext) {
    return ctx.snapshot.remote.kind === 'no-remote'
  },
  async execute(ctx): Promise<OpOutcome> {
    if (ctx.snapshot.remote.kind === 'no-remote') return { ok: true, data: undefined }
    try {
      const sg = await gitForWithAskpass(ctx.workspacePath)
      await sg.fetch(['--all', '--prune'])
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'fetch' }) }
    }
  }
}
