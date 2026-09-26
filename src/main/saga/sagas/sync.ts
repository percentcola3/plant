import { wipMessage } from '../../git/ops'
import type { SagaDefinition, SagaStep } from '../types'

// sync saga 三种模式（沿用旧 SyncOptions.mode 语义）：
// - remote：当前分支与远端同步（commit dirty + fetch + pull-rebase + push）
// - mainline：把主线最新内容 rebase 到当前分支（fetch + rebase-onto origin/main + push）
// - full：以上全部
//
// uncommittedStrategy:
// - commit：dirty 自动 commit（args.commitMessage 优先，否则 wip auto-message）
// - reject：dirty 不自动 commit；后续 op 会自然失败（pull-rebase / rebase-onto 拒绝 dirty）
//   reject + 'mainline' 模式 + dirty 时调用方应在外层提前拦截，避免假阳性"sync 失败"。

export const syncSaga: SagaDefinition = {
  intent: 'sync',
  buildSteps: (args, snapshot) => {
    const mode = (args.mode === 'remote' || args.mode === 'mainline' || args.mode === 'full')
      ? args.mode : 'full'
    const uncommittedStrategy = args.uncommittedStrategy === 'commit' ? 'commit' : 'reject'
    const commitMessage = typeof args.commitMessage === 'string' ? args.commitMessage : ''
    const steps: SagaStep[] = []

    // 1. dirty 处理
    if (uncommittedStrategy === 'commit') {
      const message = commitMessage.trim() || wipMessage(snapshot.branch, new Date().toISOString())
      steps.push({ op: 'commit', args: { message }, status: 'pending', attempts: 0 })
    }

    // 2. fetch
    steps.push({ op: 'fetch', args: {}, status: 'pending', attempts: 0 })

    // 3. pull-rebase（与同名远端同步）— mainline 模式不做
    if (mode !== 'mainline') {
      steps.push({ op: 'pull-rebase', args: {}, status: 'pending', attempts: 0 })
    }

    // 4. rebase-onto origin/main — remote 模式不做；本身就在主线时不需要
    if (mode !== 'remote' && snapshot.branch !== snapshot.defaultBranch) {
      steps.push({
        op: 'rebase-onto',
        args: { onto: `origin/${snapshot.defaultBranch}` },
        status: 'pending',
        attempts: 0
      })
    }

    // 5. push
    steps.push({ op: 'push', args: {}, status: 'pending', attempts: 0 })

    return steps
  }
}
