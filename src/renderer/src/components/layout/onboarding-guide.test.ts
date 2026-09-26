import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./OnboardingGuide.vue', import.meta.url), 'utf-8')
const sidebarSource = readFileSync(new URL('./WorkspaceSidebar.vue', import.meta.url), 'utf-8')

describe('OnboardingGuide', () => {
  it('covers DCC, CLI switching, resources, Git SSH, indexing, and skills', () => {
    expect(source).toContain('https://docs.example.com/setup/cli')
    expect(source).toContain('DCC 配置')
    expect(source).toContain('CLI 切换')
    expect(source).toContain('配置 Git SSH')
    expect(source).toContain('构建或重建索引')
    expect(source).toContain('Skill 使用与定制')
    expect(source).toContain("ui.openSettings('cli')")
    expect(source).toContain("ui.openSettings('ssh')")
    expect(source).toContain('ui.openResources()')
    expect(source).toContain('ui.openSkills()')
  })

  it('is reachable from the sidebar', () => {
    expect(sidebarSource).toContain('data-tooltip="新手引导"')
    expect(sidebarSource).toContain('ui.openGuide()')
  })
})
