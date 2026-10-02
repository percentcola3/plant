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

  it('shows directories in the workbench rather than duplicating a sidebar project list', () => {
    const workbench = readFileSync(new URL('./WorkbenchPage.vue', import.meta.url), 'utf-8')
    expect(source).not.toContain('orderedProjects')
    expect(workbench).toContain('v-for="directory in repositories"')
    expect(workbench).toContain('@click="toggleDirectory(directory.id)"')
  })
})
