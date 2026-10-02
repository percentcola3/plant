import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar navigation', () => {
  it('leaves the global document editor before switching the left navigation', () => {
    expect(source).toContain('editor.hide()')
    expect(source.match(/leaveEditor\(\)/g)).toHaveLength(4)
  })
})
