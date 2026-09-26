import { describe, expect, it } from 'vitest'
import {
  MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE,
  buildRollbackConfirmMessage,
  formatCommitAuthor,
  formatCommitTime,
  isMainBranchRollbackConfirmed
} from './branch-history'

describe('branch-history helpers', () => {
  it('格式化提交人', () => {
    expect(formatCommitAuthor({ authorName: 'Alice', authorEmail: 'alice@example.com' }))
      .toBe('Alice <alice@example.com>')
    expect(formatCommitAuthor({ authorName: '', authorEmail: 'bot@example.com' }))
      .toBe('bot@example.com')
  })

  it('格式化提交时间到分钟', () => {
    expect(formatCommitTime('2026-06-18T09:49:30')).toBe('2026-06-18 09:49')
  })

  it('主分支需要固定确认短语', () => {
    expect(MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE).toBe('确认回滚公共空间')
    expect(isMainBranchRollbackConfirmed('确认回滚公共空间')).toBe(true)
    expect(isMainBranchRollbackConfirmed('回滚公共空间')).toBe(false)
  })

  it('主分支风险文案更强', () => {
    expect(buildRollbackConfirmMessage({
      branch: 'main',
      defaultBranch: 'main',
      targetShortSha: 'abc123'
    })).toContain('高风险操作')
  })
})
