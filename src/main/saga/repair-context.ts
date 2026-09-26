import type { RepairContext, RepairContextStep } from '@shared/types'
import type { GitFailure } from '../git/failures'
import { listIncompleteJournals } from './journal'
import type { SagaJournal, SagaStep } from './types'

// 把一个失败/挂起的 SagaJournal 转成 RepairContext。
// 调用方常见路径：renderer 询问 saga.latestRepair → main 读 journal → 构造 → 返回。

export function buildRepairContext(
  journal: SagaJournal,
  workspaceName?: string
): RepairContext | null {
  if (journal.status !== 'paused-for-user' && journal.status !== 'failed') return null
  const failedIdx = journal.steps.findIndex((s) => s.status === 'failed')
  if (failedIdx < 0) return null
  const failed = journal.steps[failedIdx]
  if (!failed.failure) return null

  return {
    saga: journal.intent,
    trigger: journal.trigger,
    workspace: {
      id: journal.workspaceId,
      name: workspaceName,
      path: journal.workspacePath,
      defaultBranch: journal.defaultBranch
    },
    completedSteps: journal.steps.slice(0, failedIdx).map(toRepairStep),
    failedStep: {
      ...toRepairStep(failed),
      failureKind: failed.failure.kind,
      failureSummary: summarizeFailure(failed.failure),
      rawError: failed.failure.kind === 'UNKNOWN' ? failed.failure.raw : undefined
    },
    pendingSteps: journal.steps.slice(failedIdx + 1).map(toRepairStep),
    snapshotBefore: journal.snapshotBefore!,
    snapshotAfter: journal.snapshotAfter ?? journal.snapshotBefore!,
    attempts: failed.attempts,
    capturedAt: journal.lastTouchedAt
  }
}

export async function findLatestRepairContext(
  workspaceId: string,
  workspacePath: string,
  workspaceName?: string
): Promise<RepairContext | null> {
  const journals = await listIncompleteJournals(workspacePath)
  const candidates = journals
    .filter((j) => j.workspaceId === workspaceId)
    .filter((j) => j.status === 'paused-for-user' || j.status === 'failed')
    .sort((a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt))
  for (const j of candidates) {
    const ctx = buildRepairContext(j, workspaceName)
    if (ctx) return ctx
  }
  return null
}

function toRepairStep(step: SagaStep): RepairContextStep {
  return { op: step.op, args: step.args, status: step.status }
}

function summarizeFailure(f: GitFailure): string {
  switch (f.kind) {
    case 'CONFLICT': return `${f.during} 冲突：${f.files.join(', ') || '未指明文件'}`
    case 'NON_FAST_FORWARD': return '远端已超前；当前 push 被拒（可能需要 pull-rebase 后重推）'
    case 'AUTH': return f.host ? `远端 ${f.host} 认证失败` : '远端认证失败'
    case 'NETWORK': return `网络异常：${f.detail}`
    case 'DETACHED': return '当前处于 detached HEAD'
    case 'UNCOMMITTED': return `未提交改动：${f.files.join(', ') || '未指明文件'}`
    case 'BRANCH_TAKEN': return `分支已存在：${f.name}`
    case 'BRANCH_MISSING': return `分支不存在：${f.name}`
    case 'REBASE_IN_PROGRESS': return '已有未完成的 rebase'
    case 'NOTHING_TO_COMMIT': return '没有待提交内容'
    case 'UNKNOWN': return f.raw
  }
}

const SAGA_LABEL: Record<string, string> = {
  save: '保存当前进度',
  sync: '同步 Git 状态'
}

const STEP_LABEL: Record<string, string> = {
  commit: '提交业务改动',
  fetch: '抓取远端',
  'pull-rebase': '远端同步合并',
  'rebase-onto': '主线合并',
  push: '推送到远端',
  'squash-unpushed': '合并历史 wip'
}

// 把 RepairContext 渲染成给用户复制的中文 prompt。
// 比旧 buildGitRepairPrompt 多出：已完成步骤、剩余步骤、failure 结构化摘要、工作树/远端状态快照。
export function renderRepairPrompt(ctx: RepairContext): string {
  const lines: string[] = [
    '请帮我修复当前项目的 Git 工作流失败。',
    '',
    `动作：${SAGA_LABEL[ctx.saga] ?? ctx.saga}`,
    ctx.workspace.name ? `项目：${ctx.workspace.name}` : null,
    `仓库路径：${ctx.workspace.path}`,
    `当前分支：${ctx.snapshotAfter.branch}`,
    `主线分支：${ctx.workspace.defaultBranch}`,
    `触发来源：${ctx.trigger}`,
    '',
    '已完成步骤：',
    ...stepsAsBullets(ctx.completedSteps, '✓'),
    '',
    '失败步骤：',
    `- ${STEP_LABEL[ctx.failedStep.op] ?? ctx.failedStep.op}（尝试 ${ctx.attempts} 次）`,
    `  失败类型：${ctx.failedStep.failureKind}`,
    `  失败摘要：${ctx.failedStep.failureSummary}`,
    ctx.failedStep.rawError ? `  原始错误：${ctx.failedStep.rawError}` : null,
    '',
    '尚未执行步骤：',
    ...stepsAsBullets(ctx.pendingSteps, '·'),
    '',
    '失败时的工作区状态：',
    `- 工作树：${describeWorking(ctx.snapshotAfter)}`,
    `- 远端：${describeRemote(ctx.snapshotAfter)}`,
    `- 主线 incoming：${ctx.snapshotAfter.mainlineIncoming}`,
    '',
    '处理要求：',
    '- 先检查 git status、当前分支、rebase/merge 状态和远端状态。',
    '- 只处理这次 Git 流程需要的冲突或失败，不要改无关业务代码。',
    '- App 管理文件不要提交：AGENTS.md、CLAUDE.md、.ui-client/、.workspace/、.external/、.claude/skills/、.agents/skills/、.cursor/rules/ui-client-workspace.mdc。',
    '- 修复完成后只需要让我知道：是否可以重新触发"' + (SAGA_LABEL[ctx.saga] ?? ctx.saga) + '"流程。'
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

function stepsAsBullets(steps: RepairContextStep[], marker: string): string[] {
  if (steps.length === 0) return [`- (无)`]
  return steps.map((s) => `- ${marker} ${STEP_LABEL[s.op] ?? s.op}${s.status === 'skipped' ? '（跳过）' : ''}`)
}

function describeWorking(snap: import('@shared/types').GitSnapshot): string {
  const w = snap.working
  switch (w.kind) {
    case 'clean': return '干净'
    case 'dirty': return `${w.files.length} 个文件待提交`
    case 'rebasing': return `rebase 进行中（${w.step}/${w.total}），冲突 ${w.conflicts.length} 个`
    case 'merging': return `merge 进行中，冲突 ${w.conflicts.length} 个`
    case 'cherry-picking': return `cherry-pick 进行中，冲突 ${w.conflicts.length} 个`
    case 'reverting': return `revert 进行中，冲突 ${w.conflicts.length} 个`
    case 'detached': return `detached HEAD @ ${w.headSha.slice(0, 8)}`
  }
}

function describeRemote(snap: import('@shared/types').GitSnapshot): string {
  const r = snap.remote
  switch (r.kind) {
    case 'no-remote': return '无远端'
    case 'untracked-local': return '本地分支未跟踪远端'
    case 'tracked': return `↑ ${r.outgoing} ↓ ${r.incoming}`
  }
}
