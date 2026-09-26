import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./SkillsList.vue', import.meta.url), 'utf-8')

describe('SkillsList built-in skills', () => {
  it('labels the three built-ins in the editable installed list', () => {
    expect(source).toContain("{ name: 'ux-design', label: 'UX 设计' }")
    expect(source).toContain("{ name: 'prd-tech-review', label: 'PRD 技术评审' }")
    expect(source).toContain("{ name: 'knowledge-search', label: '知识库检索' }")
    expect(source).toContain('@click="openSkillEditor(skill.skillRelPath)"')
  })

  it('does not expose the template library or per-skill install flow', () => {
    expect(source).not.toContain('SkillTemplateLibrary')
    expect(source).not.toContain('模板库')
    expect(source).not.toContain('installBuiltinSkill')
    expect(source).toContain('class="skills-list__card"')
  })
})
