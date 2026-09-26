import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar pinned current workspace', () => {
  it('keeps the sidebar always visible without a collapse control', () => {
    expect(source).not.toContain('toggleSidebar')
    expect(source).not.toContain('sidebarCollapsed')
    expect(source).not.toContain('收起侧边栏')
    expect(source).not.toContain('展开项目栏')
  })

  it('pins the active workspace at the top of the project list', () => {
    expect(source).toContain('orderedProjects')
    expect(source).toContain('sidebar-project--pinned')
    expect(source).toContain('p.id === visibleActiveId')
  })
})
