import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('WorkspaceSidebar Peeka navigation', () => {
  it('renders the Peeka section above the workspace header with quick actions only', () => {
    const codexIndex = source.indexOf('class="sidebar-codex')
    const workspaceHeaderIndex = source.indexOf('>设计项目</span>')

    expect(codexIndex).toBeGreaterThanOrEqual(0)
    expect(workspaceHeaderIndex).toBeGreaterThan(codexIndex)
    expect(source).toContain('>Peeka</h2>')
    expect(source).toContain('aria-label="Peeka"')
    expect(source).not.toContain("label: '新建任务'")
    expect(source).not.toContain("label: '已安排'")
    expect(source).not.toContain("label: '插件'")
    expect(source).not.toContain("label: '拉取请求'")
    expect(source).not.toContain("label: '聊天'")
    expect(source).toContain("label: '剪页库'")
    expect(source).toContain("label: '新建项目'")
    expect(source).toContain('sidebar-codex__quick-actions')
    expect(source).toContain('Paperclip')
    expect(source).toContain('onPeekaQuickAction')
  })
})
