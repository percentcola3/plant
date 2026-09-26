import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFeatureResourceSelection, writeFeatureResourceSelection } from './resources'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'feature-resources-'))
  await fs.mkdir(join(workspacePath, 'features/demo'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(workspacePath, { recursive: true, force: true })
})

describe('feature resource selection', () => {
  it('stores a deduplicated project-private selection', async () => {
    const written = await writeFeatureResourceSelection(
      workspacePath,
      'features/demo',
      ['kb-1', 'ui-1', 'kb-1']
    )

    expect(written.externalRefIds).toEqual(['kb-1', 'ui-1'])
    await expect(readFeatureResourceSelection(workspacePath, 'features/demo')).resolves.toMatchObject({
      version: 1,
      externalRefIds: ['kb-1', 'ui-1']
    })
  })

  it('returns null when the project has no explicit selection', async () => {
    await expect(readFeatureResourceSelection(workspacePath, 'features/demo')).resolves.toBeNull()
  })

  it('rejects paths outside features', async () => {
    await expect(writeFeatureResourceSelection(workspacePath, '../escape', ['kb-1'])).rejects.toThrow(
      'feature path must start'
    )
  })
})
