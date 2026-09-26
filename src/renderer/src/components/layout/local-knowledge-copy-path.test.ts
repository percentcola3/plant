import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const fileTreeSource = readFileSync(
  new URL('../common/FileTree.vue', import.meta.url),
  'utf-8'
)

describe('local knowledge copy path action', () => {
  it('adds an opt-in copy action to the reusable file tree', () => {
    expect(fileTreeSource).toContain('copyable?: boolean')
    expect(fileTreeSource).toContain("(e: 'copy-path', relPath: string, kind: 'file' | 'folder'): void")
    expect(fileTreeSource).toContain("@copy-path=\"(rel, kind) => emit('copy-path', rel, kind)\"")
    expect(fileTreeSource).toContain('aria-label="复制路径"')
  })

})
