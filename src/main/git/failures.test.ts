import { describe, expect, it } from 'vitest'
import { classifyError } from './failures'

const err = (msg: string): Error => new Error(msg)

describe('classifyError', () => {
  it('NON_FAST_FORWARD before CONFLICT (push 拒绝)', () => {
    expect(classifyError(err('updates were rejected because the tip of your current branch is behind. fetch first'))).toEqual({ kind: 'NON_FAST_FORWARD' })
    expect(classifyError(err('failed to push some refs'))).toEqual({ kind: 'NON_FAST_FORWARD' })
  })

  it('REBASE_IN_PROGRESS before CONFLICT', () => {
    expect(classifyError(err('It seems that there is already a rebase-merge directory'))).toEqual({ kind: 'REBASE_IN_PROGRESS' })
  })

  it('CONFLICT picks during from context', () => {
    const e = err('CONFLICT (content): Merge conflict in src/a.ts\nCONFLICT (content): Merge conflict in src/b.ts\n')
    expect(classifyError(e, { during: 'rebase' })).toEqual({
      kind: 'CONFLICT',
      files: ['src/a.ts', 'src/b.ts'],
      during: 'rebase'
    })
  })

  it('CONFLICT infers during from message when ctx missing', () => {
    expect(classifyError(err('CONFLICT (content): Merge conflict in a.ts\nrebase failed'))).toMatchObject({ kind: 'CONFLICT', during: 'rebase' })
    expect(classifyError(err('CONFLICT in a.ts during cherry-pick'))).toMatchObject({ kind: 'CONFLICT', during: 'cherry-pick' })
    expect(classifyError(err('CONFLICT (content): Merge conflict in a.ts'))).toMatchObject({ kind: 'CONFLICT', during: 'merge' })
  })

  it('UNCOMMITTED extracts file list', () => {
    const e = err([
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\tdocs/a.md',
      '\tdocs/b.md',
      'Please commit your changes or stash them before you switch branches.'
    ].join('\n'))
    const out = classifyError(e)
    expect(out.kind).toBe('UNCOMMITTED')
    if (out.kind === 'UNCOMMITTED') {
      expect(out.files).toEqual(['docs/a.md', 'docs/b.md'])
    }
  })

  it('AUTH detects 401/403/auth-required and extracts host', () => {
    expect(classifyError(err('Authentication failed for https://github.com/foo/bar.git'))).toEqual({ kind: 'AUTH', host: 'github.com' })
    expect(classifyError(err('fatal: could not read Username for git@gitlab.com:foo'))).toEqual({ kind: 'AUTH', host: 'gitlab.com' })
    expect(classifyError(err('remote returned 403'))).toEqual({ kind: 'AUTH' })
  })

  it('NETWORK matches resolve/timeout/connect', () => {
    expect(classifyError(err('Could not resolve host: github.com')).kind).toBe('NETWORK')
    expect(classifyError(err('Operation timed out')).kind).toBe('NETWORK')
    expect(classifyError(err('Connection refused')).kind).toBe('NETWORK')
  })

  it('DETACHED', () => {
    expect(classifyError(err('You are in detached HEAD state'))).toEqual({ kind: 'DETACHED' })
  })

  it('BRANCH_TAKEN / BRANCH_MISSING use ctx.branch', () => {
    expect(classifyError(err("A branch named 'req/x' already exists"), { branch: 'req/x' }))
      .toEqual({ kind: 'BRANCH_TAKEN', name: 'req/x' })
    expect(classifyError(err("pathspec 'req/y' did not match any file"), { branch: 'req/y' }))
      .toEqual({ kind: 'BRANCH_MISSING', name: 'req/y' })
  })

  it('NOTHING_TO_COMMIT', () => {
    expect(classifyError(err('nothing to commit, working tree clean'))).toEqual({ kind: 'NOTHING_TO_COMMIT' })
  })

  it('UNKNOWN keeps raw message', () => {
    const out = classifyError(err('something completely unexpected'))
    expect(out).toEqual({ kind: 'UNKNOWN', raw: 'something completely unexpected' })
  })
})
