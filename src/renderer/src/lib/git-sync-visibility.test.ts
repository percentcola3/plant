import { describe, expect, it } from 'vitest'
import {
  shouldShowMainlineSyncButton,
  shouldShowRemoteSyncButton
} from './git-sync-visibility'

describe('git sync visibility', () => {
  it('没有状态时不显示远程同步', () => {
    expect(shouldShowRemoteSyncButton(null)).toBe(false)
  })

  it('本分支和远端存在提交差异时显示远程同步', () => {
    expect(shouldShowRemoteSyncButton({ isDirty: false, hasRemote: true, ahead: 1, behind: 0 })).toBe(true)
    expect(shouldShowRemoteSyncButton({ isDirty: false, hasRemote: true, ahead: 0, behind: 1 })).toBe(true)
  })

  it('有未保存业务改动时显示远程同步，因为会执行提交和推送', () => {
    expect(shouldShowRemoteSyncButton({ isDirty: true, hasRemote: true, ahead: 0, behind: 0 })).toBe(true)
  })

  it('没有远端或没有差异时不显示远程同步', () => {
    expect(shouldShowRemoteSyncButton({ isDirty: true, hasRemote: false, ahead: 0, behind: 0 })).toBe(false)
    expect(shouldShowRemoteSyncButton({ isDirty: false, hasRemote: true, ahead: 0, behind: 0 })).toBe(false)
  })

  it('当前分支缺少公共空间最新内容时显示同步公共空间', () => {
    expect(shouldShowMainlineSyncButton({ mainlineBehind: 2 })).toBe(true)
  })

  it('当前分支已包含公共空间最新内容时不显示同步公共空间', () => {
    expect(shouldShowMainlineSyncButton({ mainlineBehind: 0 })).toBe(false)
    expect(shouldShowMainlineSyncButton(null)).toBe(false)
  })
})
