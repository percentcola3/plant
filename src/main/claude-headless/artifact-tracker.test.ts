import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  compareArtifactSnapshots,
  snapshotProjectArtifacts
} from './artifact-tracker'

describe('artifact-tracker', () => {
  it('detects created and modified project artifacts while ignoring node_modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-client-artifacts-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'old.md'), 'before')
    writeFileSync(join(dir, 'node_modules', 'pkg', 'ignored.md'), 'before')

    const before = snapshotProjectArtifacts(dir)

    writeFileSync(join(dir, 'docs', 'old.md'), 'after')
    writeFileSync(join(dir, 'docs', 'new.md'), 'new')
    writeFileSync(join(dir, 'node_modules', 'pkg', 'ignored.md'), 'after')

    const after = snapshotProjectArtifacts(dir)

    expect(compareArtifactSnapshots(before, after)).toEqual([
      'docs/new.md',
      'docs/old.md'
    ])
  })

  it('忽略 .ui-client / .workspace / .external（App 内部状态不算业务改动）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-client-artifacts-app-managed-'))
    mkdirSync(join(dir, '.ui-client', 'sagas', 'done'), { recursive: true })
    mkdirSync(join(dir, '.workspace'), { recursive: true })
    mkdirSync(join(dir, '.external'), { recursive: true })
    mkdirSync(join(dir, 'outputs'), { recursive: true })
    writeFileSync(join(dir, 'outputs', 'index.html'), 'before')

    const before = snapshotProjectArtifacts(dir)

    // 业务改动
    writeFileSync(join(dir, 'outputs', 'index.html'), 'after')
    // App 内部状态改动，应被忽略
    writeFileSync(join(dir, '.ui-client', 'sagas', 'done', 'save-1234.json'), '{}')
    writeFileSync(join(dir, '.workspace', 'project-context.json'), '{}')
    writeFileSync(join(dir, '.external', 'some-ref.md'), 'external')

    const after = snapshotProjectArtifacts(dir)
    expect(compareArtifactSnapshots(before, after)).toEqual(['outputs/index.html'])
  })
})
