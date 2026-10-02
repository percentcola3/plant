import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar project navigation', () => {
  it('keeps project and requirement views under the workbench entry', () => {
    expect(source).toContain("ui.currentView === 'project-management' || ui.currentView === 'features-page' || ui.currentView === 'project-home'")
    expect(source).toContain('aria-label="工作台"')
    expect(source).toContain(':aria-current=')
  })
})
