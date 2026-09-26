import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { importUiProduct } from './import-product'

describe('importUiProduct', () => {
  it('copies a local project folder into outputs using the source folder name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'product-import-'))
    const workspacePath = join(root, 'workspace')
    const sourcePath = join(root, 'checkout-page')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'index.html'), '<main>Checkout</main>')

    try {
      const result = await importUiProduct({ workspacePath, sourcePath })

      expect(result.productRelPath).toBe('outputs/checkout-page')
      expect(result.htmlRelPath).toBe('outputs/checkout-page/index.html')
      expect(result.fileCount).toBeGreaterThanOrEqual(1)
      await expect(readFile(join(workspacePath, 'outputs/checkout-page/index.html'), 'utf-8'))
        .resolves.toContain('Checkout')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects folders without a root index.html', async () => {
    const root = await mkdtemp(join(tmpdir(), 'product-import-invalid-'))
    const workspacePath = join(root, 'workspace')
    const sourcePath = join(root, 'notes-only')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'README.md'), '# no preview')

    try {
      await expect(importUiProduct({ workspacePath, sourcePath }))
        .rejects.toThrow('index.html')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
