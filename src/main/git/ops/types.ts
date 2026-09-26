import type { GitSnapshot } from '@shared/types'
import type { GitFailure } from '../failures'

// op 是 saga 的执行单元。规则：
// - isSatisfied 判定"无需执行"（幂等支持）。runner 在执行前看一眼，已满足就跳过。
// - execute 只关注当前这一步的 git 动作。pre / post snapshot 由 runner 统一处理。
// - 一切失败必须走 classifyError 转成 GitFailure；不要往外抛字符串错误。

export type OpOutcome<T = void> =
  | { ok: true; data: T }
  | { ok: false; failure: GitFailure }

export type OpContext = {
  workspacePath: string
  snapshot: GitSnapshot                // 执行前一刻的快照
}

export interface GitOp<TArgs = void, TData = void> {
  readonly name: string
  readonly idempotent: boolean
  isSatisfied(ctx: OpContext, args: TArgs): boolean
  execute(ctx: OpContext, args: TArgs): Promise<OpOutcome<TData>>
}
