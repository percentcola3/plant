import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar footer actions', () => {
  it('keeps primary navigation in the workspace rail', () => {
    expect(source).toContain('class="workspace-rail"')
    expect(source).toContain('aria-label="首页"')
    expect(source).toContain('aria-label="项目管理"')
    expect(source).toContain('aria-label="资源包"')
    expect(source).toContain('aria-label="技能"')
    expect(source).not.toContain('class="sidebar-footer-action"')
  })

  it('does not render settings in the sidebar footer', () => {
    expect(source).not.toContain('sidebar-settings-btn')
    expect(source).not.toContain('@click="ui.openSettings()"')
    expect(source).not.toContain('<span>设置</span>')
  })
})
