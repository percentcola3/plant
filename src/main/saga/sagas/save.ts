import { wipMessage } from '../../git/ops'
import type { SagaDefinition, SagaStep } from '../types'

// save saga 三种调用方式：
// - auto-save / fs-change：     args = { release: false, pushAfter: true }   message 由 saga 自动生成 wip(...)
// - before-quit / startup：      args = { release: false, pushAfter: false }  只 commit 不 push
// - 用户点"打版本"：              args = { release: true, message: '...', pushAfter: true } commit + squash 历史 + push
//
// 注意 buildSteps 只在 saga 创建时跑一次；resume 不会重建 steps。所以 wip 的 ISO 时间不会因 resume 漂移。

export const saveSaga: SagaDefinition = {
  intent: 'save',
  buildSteps: (args, snapshot) => {
    const release = args.release === true
    const pushAfter = args.pushAfter !== false
    const userMessage = typeof args.message === 'string' ? args.message.trim() : ''
    const steps: SagaStep[] = []

    // 1. commit 当前 dirty 工作树
    // 永远用 wip 作为本步 message——干净的"用户版本号"由步骤 2 的 squash 负责贴上去。
    // 这样语义清晰：step 1 = 把改动落盘，step 2 = 起名字。
    const commitMessage = wipMessage(snapshot.branch, new Date().toISOString())
    steps.push({ op: 'commit', args: { message: commitMessage }, status: 'pending', attempts: 0 })

    // 2. release 模式：把当前分支领先远端的所有 commit（含历史 wip + 步骤 1 刚 commit 的）squash 成一笔
    if (release && userMessage) {
      steps.push({ op: 'squash-unpushed', args: { message: userMessage }, status: 'pending', attempts: 0 })
    }

    // 3. push（默认开；before-quit 显式关掉）
    if (pushAfter) {
      steps.push({ op: 'push', args: {}, status: 'pending', attempts: 0 })
    }

    return steps
  }
}
