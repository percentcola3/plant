import { isAppManagedPath } from '@shared/app-managed-paths'

export type DirtyChange = {
  path: string
  index?: string
  workingDir?: string
}

type DirtyDetails = {
  changes: DirtyChange[]
}

export type ChangeGuideAiPromptInput = {
  workspaceName?: string
  branch?: string
  changedFiles: Array<{ path: string; kind: 'added' | 'deleted' | 'modified' }>
  diffSummaries?: Array<{ path: string; diff: string; truncated?: boolean }>
}

type ClipboardCopyResult = { ok: true } | { ok: false; message: string }

export type CopyChangeGuidePromptActions = {
  copyToClipboard: (text: string) => Promise<ClipboardCopyResult>
  showToast: (kind: 'success' | 'error' | 'info', message: string, durationMs?: number) => void
  openTerminalPanel: () => void
  closeDialog: () => void
}

function isDirtyDetails(value: unknown): value is DirtyDetails {
  return !!value && typeof value === 'object' && Array.isArray((value as DirtyDetails).changes)
}

export function labelForStatus(index?: string, workingDir?: string): string {
  const status = `${index ?? ''}${workingDir ?? ''}`
  if (status.includes('?')) return '未跟踪'
  if (status.includes('D')) return '删除'
  if (status.includes('A')) return '新增'
  if (status.includes('R')) return '重命名'
  if ((index ?? '').trim() && status.includes('M')) return '已暂存修改'
  if (status.includes('M')) return '修改'
  return '改动'
}

export function buildCommitPromptMessage(reason: string, details: unknown): string {
  const lines = [`${reason}前需要先处理当前未提交改动。`]

  if (!isDirtyDetails(details) || details.changes.length === 0) {
    lines.push('当前 Git 工作区不是干净状态。请确认这些改动是否需要保存，然后写一句版本说明。')
    return lines.join('\n')
  }

  const visibleChanges = details.changes.filter((change) => !isAppManagedPath(change.path))
  if (visibleChanges.length === 0) {
    lines.push('当前只检测到应用内部会话状态文件变动，不需要保存为版本。请重试刚才的操作。')
    return lines.join('\n')
  }

  lines.push(`检测到 ${visibleChanges.length} 个业务文件变动，请确认是否保存为一个版本：`)
  for (const change of visibleChanges.slice(0, 12)) {
    lines.push(`• ${labelForStatus(change.index, change.workingDir)}：${change.path}`)
  }
  if (visibleChanges.length > 12) {
    lines.push(`• 还有 ${visibleChanges.length - 12} 个文件未展示`)
  }
  lines.push('')
  lines.push('请用一句话描述这次改动。')
  return lines.join('\n')
}

export function buildChangeGuideAiPrompt(input: ChangeGuideAiPromptInput): string {
  const lines = [
    '请帮我分析当前 Git 工作区的业务改动。',
    input.workspaceName ? `项目：${input.workspaceName}` : null,
    input.branch ? `分支：${input.branch}` : null,
    '',
    '改动文件：'
  ].filter((line): line is string => line !== null)

  if (input.changedFiles.length === 0) {
    lines.push('- 当前没有业务文件改动。')
  } else {
    for (const file of input.changedFiles) {
      const label = file.kind === 'added' ? '新增' : file.kind === 'deleted' ? '删除' : '修改'
      lines.push(`- ${label}: ${file.path}`)
    }
  }

  lines.push('')
  if (input.diffSummaries?.length) {
    lines.push('变更内容：')
    for (const item of input.diffSummaries) {
      lines.push(`\n### ${item.path}${item.truncated ? '（内容已截断）' : ''}`)
      lines.push('```diff')
      lines.push(item.diff || '未检测到可展示的文本 diff。')
      lines.push('```')
    }
    lines.push('')
  }
  lines.push('请分析这些变更的影响范围，判断是否可以直接提交，指出可能需要补充确认或拆分提交的地方，并给出建议的提交说明。')
  return lines.join('\n')
}

export async function copyChangeGuidePromptToClipboardAndOpenTerminal(
  input: ChangeGuideAiPromptInput,
  actions: CopyChangeGuidePromptActions
): Promise<boolean> {
  const prompt = buildChangeGuideAiPrompt(input)
  const result = await actions.copyToClipboard(prompt)
  if (!result.ok) {
    actions.showToast('error', `复制失败：${result.message}`)
    return false
  }

  actions.closeDialog()
  actions.openTerminalPanel()
  actions.showToast('success', '已复制给 AI 的改动分析提示词')
  return true
}
