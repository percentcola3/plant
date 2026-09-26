import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar branch active state', () => {
  it('uses the same left primary status line for the active requirement branch', () => {
    expect(source).toContain('ui.viewingRequirementIdSlug === `${r.id}-${r.slug}`')
    expect(source).toContain('before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary')
  })
})
