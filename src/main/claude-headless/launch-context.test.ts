import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveClaudeLaunchContext } from './launch-context'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-launch-context-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveClaudeLaunchContext', () => {
  it('uses the active work area as cwd and adds the project readable windows', () => {
    mkdirSync(join(root, '.external'), { recursive: true })

    expect(resolveClaudeLaunchContext(root, { kind: 'feature', relPath: 'features/payments' }))
      .toEqual({
        workDir: join(root, 'features/payments'),
        addDirs: [root, join(root, '.external')]
      })
  })

  it('keeps root cwd and no extra add-dir when there is no active work area', () => {
    mkdirSync(join(root, '.external'), { recursive: true })

    expect(resolveClaudeLaunchContext(root, null)).toEqual({
      workDir: root,
      addDirs: []
    })
  })
})
