type GitRepairPromptInput = {
  action: 'save' | 'sync' | 'complete' | 'rollback'
  workspaceName?: string
  branch?: string
  defaultBranch?: string
  targetSha?: string
  phase?: string
  code?: string
  message: string
}

const ACTION_LABEL: Record<GitRepairPromptInput['action'], string> = {
  save: '保存当前进度',
  sync: '同步 Git 状态',
  complete: '完成需求并合入团队空间',
  rollback: '回滚历史版本'
}

export function buildGitRepairPrompt(input: GitRepairPromptInput): string {
  const lines = [
    '请帮我修复当前项目的 Git 工作流失败。',
    '',
    `动作：${ACTION_LABEL[input.action]}`,
    input.workspaceName ? `项目：${input.workspaceName}` : null,
    input.branch ? `当前分支：${input.branch}` : null,
    input.defaultBranch ? `公共空间分支：${input.defaultBranch}` : null,
    input.targetSha ? `目标版本：${input.targetSha}` : null,
    input.phase ? `失败阶段：${input.phase}` : null,
    input.code ? `错误类型：${input.code}` : null,
    '',
    '错误信息：',
    input.message,
    '',
    '处理要求：',
    '- 先检查 git status、当前分支、rebase/merge 状态和远端状态。',
    '- 只处理这次 Git 流程需要的冲突或失败，不要改无关业务代码。',
    '- App 管理文件不要提交，例如 AGENTS.md、CLAUDE.md、.ui-client/、.workspace/、.external/、.claude/skills/、.agents/skills/、.cursor/rules/ui-client-workspace.mdc。',
    '- 如果存在冲突，请解释冲突文件和采用的解决策略，再继续 rebase/merge。',
    input.action === 'rollback' ? '- 如果存在 revert 冲突，请先解释冲突文件和采用的解决策略，再继续回滚。' : null,
    input.action === 'rollback'
      ? '- 修复完成后告诉我是否需要重新点击“历史版本”继续。'
      : '- 修复完成后告诉我应该重新点击“保存”“同步”还是“完成”。'
  ].filter((line): line is string => line !== null)

  return lines.join('\n')
}

export function titleForGitRepair(action: GitRepairPromptInput['action']): string {
  return `${ACTION_LABEL[action]}失败`
}
