import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./OpenWithMenu.vue', import.meta.url), 'utf-8')

describe('OpenWithMenu component', () => {
  it('分体按钮 + 下拉菜单，调用 system.openProjectTool 并透传 relativePath', () => {
    expect(source).toContain('class="open-with-menu__tool-btn')
    expect(source).toContain('class="open-with-menu__tool-chevron"')
    expect(source).toContain('open-with-menu__dropdown-header')
    expect(source).toContain('Open with')
    expect(source).toContain('@click.stop="openDefault"')
    expect(source).toContain('@click.stop="toggleMenu"')
    expect(source).toContain("call('system.openProjectTool'")
    expect(source).toContain('relativePath: props.relPath')
    expect(source).toContain('kind: item.kind')
    expect(source).toContain('workspaceId: props.workspaceId')
  })

  it('复用 project-tool-menu 与共享默认值 key', () => {
    expect(source).toContain("from '@/lib/project-tool-menu'")
    expect(source).toContain("'workspace.defaultProjectTool'")
    expect(source).toContain('buildProjectToolMenuItems')
  })

  it('props 含 workspaceId / relPath / size', () => {
    expect(source).toContain('workspaceId: string')
    expect(source).toContain('relPath?: string')
    expect(source).toContain("size?: 'sm' | 'xs'")
  })

  it('菜单项可设默认（makeDefault）并写回 localStorage', () => {
    expect(source).toContain('makeDefault: true')
    expect(source).toContain('window.localStorage.setItem')
  })

  it('uses peeka-style app icons for the tool trigger and dropdown items', () => {
    expect(source).toContain("from '@/assets/project-tools/app-cursor.png'")
    expect(source).toContain('open-with-menu__dropdown-item--active')
    expect(source).toContain('role="menuitemradio"')
  })
})
