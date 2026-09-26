import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarSource = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('workspace navigation', () => {
  it('keeps app-level project, resource, and skill destinations in the navigation rail', () => {
    expect(sidebarSource).toContain('class="workspace-rail"')
    expect(sidebarSource).toContain('@click="openProjectManagement"')
    expect(sidebarSource).toContain('@click="openResources"')
    expect(sidebarSource).toContain('@click="openSkills"')
    expect(sidebarSource).toContain("ui.currentView === 'ai-config'")
    expect(sidebarSource).toContain("ui.currentView === 'skills-config'")
  })

})
