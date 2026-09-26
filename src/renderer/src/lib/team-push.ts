// 推送到团队空间：renderer 侧共享调用 + 结果路由。
// 两个调用点（FeaturesPage feature 卡 / UxWorkspacePage outputs 项）共用，避免重复。
import { useUiStore } from '@/stores/ui'
import { call } from './api'

export type TeamPushUiTarget = {
  relPath: string
  name: string
  type: 'feat' | 'ui'
}

// 冲突时给 AI 的提示词：指明临时 worktree 目录 + 冲突文件，让 AI 在那里解决后自行 push。
// 复用 ui.openAiRepairPrompt → AiRepairPromptDialog（复制提示词 / 复制并打开 AI 对话）。
function buildConflictPrompt(
  target: TeamPushUiTarget,
  worktreePath: string | undefined,
  conflictFiles: string[] | undefined
): string {
  const files = (conflictFiles ?? []).length > 0 ? conflictFiles!.join('\n') : '（未取到具体文件，请在临时目录跑 git status 查看）'
  return [
    `我正在把工作空间里的 ${target.relPath}（${target.name}）推送到团队空间，拉取最新团队空间内容时遇到冲突。`,
    '',
    '临时工作目录（请在此处操作）：',
    `  ${worktreePath ?? '（未取到路径）'}`,
    '',
    '冲突文件：',
    files,
    '',
    '请帮我：',
    `1. cd 到上面的临时目录`,
    '2. 逐个查看冲突文件，理解「你的改动」和「团队空间已有内容」两侧',
    '3. 逐个解决冲突——保留该保留的、合并该合并的',
    `4. 全部解决后执行 git add + git commit + git push origin HEAD:main`,
    '5. 完成后告诉我，我会清理临时目录',
    '',
    '注意：不要动这个临时目录之外的文件；不要 force push。'
  ].join('\n')
}

// 调 team.push 并路由结果：成功 / 空 / 冲突(弹 AI 提示词) / 其它失败(toast)。
// 返回最终 outcome，调用方可用它管理 loading 态。
export async function pushToTeamSpaceFromUi(
  workspaceId: string,
  target: TeamPushUiTarget
): Promise<{ ok: boolean }> {
  const ui = useUiStore()
  ui.showToast('info', `开始推送 ${target.name} 到团队空间…`)
  const r = await call('team.push', { workspaceId, ...target })
  // 外层 IpcResult 失败（handler 抛错，如工作区不存在）
  if (!r.ok) {
    ui.showToast('error', `推送失败：${r.message}`, 5000)
    return { ok: false }
  }
  const outcome = r.data
  if (outcome.ok) {
    ui.showToast('success', outcome.empty ? '团队空间内容已与你一致，无需推送' : `${target.name} 已推送到团队空间`)
    return { ok: true }
  }
  if (outcome.code === 'CONFLICT') {
    ui.openAiRepairPrompt({
      title: '与团队空间冲突',
      message: `${target.name} 与团队空间已有内容冲突，复制提示词到 AI 对话解决`,
      prompt: buildConflictPrompt(target, outcome.worktreePath, outcome.conflictFiles),
      abort: outcome.worktreePath ? { workspaceId, worktreePath: outcome.worktreePath } : undefined
    })
    return { ok: false }
  }
  ui.showToast('error', `推送失败：${outcome.message}`, 5000)
  return { ok: false }
}
