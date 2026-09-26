import { formatDateTimeMinute } from './date-format'

export const MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE = '确认回滚公共空间'

export function formatCommitAuthor(input: { authorName: string; authorEmail: string }): string {
  const name = input.authorName.trim()
  const email = input.authorEmail.trim()
  if (name && email) return `${name} <${email}>`
  return name || email || '未知提交人'
}

export function formatCommitTime(value: string): string {
  return formatDateTimeMinute(value, value)
}

export function isDefaultBranch(branch: string | undefined, defaultBranch: string | undefined): boolean {
  return !!branch && !!defaultBranch && branch === defaultBranch
}

export function isMainBranchRollbackConfirmed(value: string): boolean {
  return value.trim() === MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE
}

export function buildRollbackConfirmMessage(input: {
  branch: string
  defaultBranch: string
  targetShortSha: string
}): string {
  if (isDefaultBranch(input.branch, input.defaultBranch)) {
    return [
      '高风险操作：你正在回滚公共空间。',
      '这会影响所有基于公共空间继续开发的人，也可能撤销已同步给团队的内容。',
      `目标版本：${input.targetShortSha}`,
      `请输入「${MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE}」继续。`
    ].join('\n')
  }
  return [
    '将使用 git revert 生成反向提交，把当前分支回滚到所选版本。',
    '这会撤销该版本之后的提交内容。请确认当前改动已保存。',
    `目标版本：${input.targetShortSha}`
  ].join('\n')
}
