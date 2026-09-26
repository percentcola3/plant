import { describe, expect, it } from 'vitest'
import type { GitSnapshot } from '@shared/types'
import { buildRepairContext, renderRepairPrompt } from './repair-context'
import type { SagaJournal } from './types'

const baseSnap: GitSnapshot = {
  workspacePath: '/tmp/ws',
  branch: 'req/x',
  defaultBranch: 'main',
  working: { kind: 'dirty', files: [{ path: 'docs/a.md', kind: 'modified' }] },
  remote: { kind: 'tracked', outgoing: 1, incoming: 2 },
  mainlineIncoming: 0,
  headSha: 'aaa',
  takenAt: 0
}

function buildJournal(over: Partial<SagaJournal> = {}): SagaJournal {
  return {
    id: 'sync-abc',
    intent: 'sync',
    workspaceId: 'ws-1',
    workspacePath: '/tmp/ws',
    defaultBranch: 'main',
    trigger: 'user',
    args: { mode: 'full' },
    steps: [
      { op: 'commit', args: {}, status: 'done', attempts: 1 },
      { op: 'fetch', args: {}, status: 'done', attempts: 1 },
      {
        op: 'pull-rebase', args: {}, status: 'failed', attempts: 2,
        failure: { kind: 'CONFLICT', files: ['docs/a.md', 'docs/b.md'], during: 'rebase' }
      },
      { op: 'push', args: {}, status: 'pending', attempts: 0 }
    ],
    currentStep: 2,
    status: 'paused-for-user',
    snapshotBefore: baseSnap,
    snapshotAfter: baseSnap,
    createdAt: '2026-06-12T18:00:00Z',
    lastTouchedAt: '2026-06-12T18:00:30Z',
    schemaVersion: 1,
    ...over
  }
}

describe('buildRepairContext', () => {
  it('returns null for non-failed journal', () => {
    expect(buildRepairContext(buildJournal({ status: 'running' }))).toBeNull()
    expect(buildRepairContext(buildJournal({ status: 'done' }))).toBeNull()
  })

  it('packages completed / failed / pending steps separately', () => {
    const ctx = buildRepairContext(buildJournal(), 'demo project')
    expect(ctx).not.toBeNull()
    expect(ctx!.workspace.name).toBe('demo project')
    expect(ctx!.completedSteps.map((s) => s.op)).toEqual(['commit', 'fetch'])
    expect(ctx!.failedStep.op).toBe('pull-rebase')
    expect(ctx!.failedStep.failureKind).toBe('CONFLICT')
    expect(ctx!.failedStep.failureSummary).toContain('docs/a.md')
    expect(ctx!.pendingSteps.map((s) => s.op)).toEqual(['push'])
    expect(ctx!.attempts).toBe(2)
  })

  it('captures unknown error raw text', () => {
    const j = buildJournal({
      steps: [{
        op: 'push', args: {}, status: 'failed', attempts: 1,
        failure: { kind: 'UNKNOWN', raw: 'mysterious git output' }
      }],
      currentStep: 0
    })
    const ctx = buildRepairContext(j)
    expect(ctx!.failedStep.rawError).toBe('mysterious git output')
  })
})

describe('renderRepairPrompt', () => {
  it('contains saga label, workspace info, completed/failed/pending sections', () => {
    const ctx = buildRepairContext(buildJournal(), 'demo')!
    const text = renderRepairPrompt(ctx)
    expect(text).toContain('动作：同步 Git 状态')
    expect(text).toContain('项目：demo')
    expect(text).toContain('已完成步骤')
    expect(text).toContain('失败步骤')
    expect(text).toContain('rebase 冲突')
    expect(text).toContain('docs/a.md')
    expect(text).toContain('尚未执行步骤')
    expect(text).toContain('推送到远端')
    expect(text).toContain('AGENTS.md、CLAUDE.md')
  })

  it('describes working/remote state from snapshot', () => {
    const ctx = buildRepairContext(buildJournal(), 'demo')!
    const text = renderRepairPrompt(ctx)
    expect(text).toMatch(/工作树：1 个文件待提交/)
    expect(text).toMatch(/远端：↑ 1 ↓ 2/)
  })

  it('handles rebasing snapshot', () => {
    const snap = { ...baseSnap, working: { kind: 'rebasing' as const, step: 2, total: 5, conflicts: ['x.md'] } }
    const ctx = buildRepairContext(buildJournal({ snapshotAfter: snap }), 'demo')!
    const text = renderRepairPrompt(ctx)
    expect(text).toContain('rebase 进行中（2/5）')
  })

  it('handles no-remote snapshot', () => {
    const snap = { ...baseSnap, remote: { kind: 'no-remote' as const } }
    const ctx = buildRepairContext(buildJournal({ snapshotAfter: snap }), 'demo')!
    expect(renderRepairPrompt(ctx)).toContain('远端：无远端')
  })
})
