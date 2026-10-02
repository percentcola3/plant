import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar rail navigation', () => {
  it('renders the main navigation rail with the three primary views', () => {
    expect(source).toContain('aria-label="主导航"')
    expect(source).toContain('workspace-rail__button')
    expect(source).not.toContain('aria-label="首页"')
    expect(source).toContain('aria-label="工作台"')
    expect(source).toContain('aria-label="知识库"')
    expect(source).toContain('aria-label="技能"')
  })

  it('marks the active view with aria-current and highlights linked views', () => {
    expect(source).toContain(`ui.currentView === 'project-management' || ui.currentView === 'features-page' || ui.currentView === 'project-home'`)
  })

  it('leaves the editor before switching views so the rail always returns home-level surfaces', () => {
    expect(source).toContain('function leaveEditor(): void')
    expect(source).toContain('editor.hide()')
  })
})
