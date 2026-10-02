import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./TopBar.vue', import.meta.url), 'utf-8')

describe('TopBar theme', () => {
  it('uses the Plant-style tab bar with home, project tabs, and add controls', () => {
    expect(source).toContain('class="app-tabbar app-chrome topbar-drag shrink-0"')
    expect(source).toContain('class="app-tabbar__inset"')
    expect(source).toContain('min-width: 80px')
    expect(source).not.toContain('compactTrafficLightInset')
    expect(source).not.toContain('checkWindowExpanded')
    expect(source).not.toContain('screen.availWidth')
    expect(source).not.toContain('system.getWindowChromeState')
    expect(source).not.toContain('window.chrome-state')
    expect(source).not.toContain('.app-tabbar--compact-leading .app-tabbar__inset')
    expect(source).toContain('class="app-tabbar__home"')
    expect(source).toContain('class="app-tab app-tab--active"')
    expect(source).toContain('class="app-tab__close"')
    expect(source).toContain('previewProjectTabs')
    expect(source).toContain('activateProjectTab')
    expect(source).toContain('closeProjectTab')
    expect(source).toContain('hideCanvas')
    expect(source).not.toContain('previewStore.clearAll()')
    expect(source).toContain('shouldShowTopBarContextTab')
    expect(source).toContain('class="app-tabbar__add"')
    expect(source).toContain('resolveTopBarTabTitle')
    expect(source).not.toContain('UX 项目')
  })

  it('uses Lucide icons for home, file tabs, add, and close controls', () => {
    expect(source).toContain("import { FolderKanban, ListTodo, PenTool, Plus, X } from 'lucide-vue-next'")
    expect(source).toContain('<FolderKanban class="app-tabbar__glyph app-tabbar__glyph--md"')
    expect(source).toContain('<PenTool class="app-tabbar__glyph app-tabbar__glyph--sm"')
    expect(source).toContain('<Plus class="app-tabbar__glyph app-tabbar__glyph--md"')
    expect(source).toContain('<X class="app-tabbar__glyph app-tabbar__glyph--xs"')
    expect(source).not.toContain('viewBox="0 0 16 16"')
  })

  it('uses an icon-only AI task control with a neutral badge for active tasks', () => {
    expect(source).toContain('const aiTaskBadgeCount = computed(() => aiTasks.activeCount + aiTasks.waitingCount)')
    expect(source).toContain('class="ai-task-topbar-btn__badge"')
    expect(source).toContain('ai-task-topbar-btn__icon')
    expect(source).toContain('background: var(--color-bg-hover)')
    expect(source).not.toContain('<span>AI 任务</span>')
    expect(source).not.toContain('aiTasks.tasks.length')
    expect(source).not.toContain('#ef4444')
  })

  it('places settings and utility actions on the right side of the tab bar', () => {
    expect(source).toContain('import TopBarSettingsButton from')
    expect(source).toContain('<TopBarSettingsButton />')
    expect(source).toContain('class="app-tabbar__actions topbar-actions"')
    expect(source).not.toContain('style="padding-left: 80px"')
    expect(source).not.toContain('.app-tabbar__nav:not(:has(.app-tab)) .app-tabbar__home--active')
    expect(source).not.toContain('compactTrafficLightInset')
    expect(source).not.toContain("window.addEventListener('resize', checkWindowExpanded)")
    expect(source).toContain('margin-left: auto')
    expect(source).toContain('<OpenProjectDialog')
  })
})
