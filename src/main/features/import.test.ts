import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { importFeature } from './lifecycle'

describe('importFeature', () => {
  it('copies a local project folder into features using the source folder name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feature-import-'))
    const workspacePath = join(root, 'workspace')
    const sourcePath = join(root, 'pix-offline')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'index.html'), '<main>PIX offline</main>')
    await writeFile(join(sourcePath, 'README.md'), '# PIX offline')

    try {
      const result = await importFeature({ workspacePath, sourcePath })

      expect(result).toEqual({ featureRelPath: 'features/pix-offline' })
      await expect(readFile(join(workspacePath, 'features/pix-offline/index.html'), 'utf-8'))
        .resolves.toContain('PIX offline')
      await expect(readFile(join(workspacePath, 'features/pix-offline/README.md'), 'utf-8'))
        .resolves.toContain('PIX offline')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
