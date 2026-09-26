import { describe, expect, it } from 'vitest'
import type { GitSnapshot } from '@shared/types'
import { saveSaga } from './save'

const baseSnap: GitSnapshot = {
  workspacePath: '/tmp/ws',
  branch: 'req/x',
  defaultBranch: 'main',
  working: { kind: 'clean' },
  remote: { kind: 'tracked', outgoing: 0, incoming: 0 },
  mainlineIncoming: 0,
  headSha: 'aaa',
  takenAt: 0
}

describe('saveSaga.buildSteps', () => {
  it('auto-save: commit + push', () => {
    const steps = saveSaga.buildSteps({ release: false, pushAfter: true }, baseSnap)
    expect(steps.map((s) => s.op)).toEqual(['commit', 'push'])
    expect(steps[0].args.message).toMatch(/^wip\(req\/x\): /)
  })

  it('before-quit: commit only', () => {
    const steps = saveSaga.buildSteps({ release: false, pushAfter: false }, baseSnap)
    expect(steps.map((s) => s.op)).toEqual(['commit'])
  })

  it('release with user message: commit + squash + push', () => {
    const steps = saveSaga.buildSteps({ release: true, message: 'feat: ship v2', pushAfter: true }, baseSnap)
    expect(steps.map((s) => s.op)).toEqual(['commit', 'squash-unpushed', 'push'])
    expect(steps[0].args.message).toMatch(/^wip\(/)
    expect(steps[1].args.message).toBe('feat: ship v2')
  })

  it('release without user message: skip squash (no name to give)', () => {
    const steps = saveSaga.buildSteps({ release: true, message: '   ', pushAfter: true }, baseSnap)
    expect(steps.map((s) => s.op)).toEqual(['commit', 'push'])
  })

  it('release with pushAfter=false: still does squash but no push', () => {
    const steps = saveSaga.buildSteps({ release: true, message: 'v2', pushAfter: false }, baseSnap)
    expect(steps.map((s) => s.op)).toEqual(['commit', 'squash-unpushed'])
  })

  it('uses snapshot.branch in wip message', () => {
    const s = saveSaga.buildSteps({ release: false, pushAfter: true }, { ...baseSnap, branch: 'feature/login' })
    expect(s[0].args.message).toMatch(/^wip\(feature\/login\): /)
  })

  it('all steps start as pending with attempts=0', () => {
    const s = saveSaga.buildSteps({ release: false, pushAfter: true }, baseSnap)
    for (const step of s) {
      expect(step.status).toBe('pending')
      expect(step.attempts).toBe(0)
    }
  })
})
