import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mentionSource = readFileSync(new URL('./MentionPopover.vue', import.meta.url), 'utf-8')
const composerSource = readFileSync(new URL('./ChatComposer.vue', import.meta.url), 'utf-8')
const addSkillSource = readFileSync(new URL('../layout/AddSkillForm.vue', import.meta.url), 'utf-8')

describe('AI work panel resource shortcuts', () => {
  it('loads attached knowledge, component effects and other project files', () => {
    expect(mentionSource).toContain("{ key: 'current', label: '当前项目'")
    expect(mentionSource.indexOf("label: '当前项目'"))
      .toBeLessThan(mentionSource.indexOf("label: '知识库'"))
    expect(mentionSource).toContain('buildCurrentProjectNodes')
    expect(mentionSource).toContain('resourceKind: \'current-project\'')
    expect(mentionSource).toContain("workspaces.scan?.kind === 'project'")
    expect(mentionSource).toContain('resolveMentionResourceBindings(pool, scannedBindings, fetchedBindings)')
    expect(mentionSource).not.toContain('externalRefs.resolvedBindings')
    expect(mentionSource).not.toContain("call('feature.resources.get'")
    expect(mentionSource).toContain("call('workspace.listFiles'")
    expect(mentionSource).toContain('勾选目录或文件加入上下文')
    expect(mentionSource).toContain('item: knowledgeResourceItem(binding.alias, rootRel)')
    expect(mentionSource).toContain('item: projectResourceItem(feature, feature.relPath)')
    expect(mentionSource).toContain("call('workspace.uikitSummary'")
    expect(mentionSource).toContain('component.demoPaths ??')
    expect(mentionSource).toContain("call('feature.list'")
    expect(mentionSource).toContain("{ key: 'elements', label: '选中元素'")
    expect(mentionSource).toContain('function sectionCount')
    expect(mentionSource).toContain('mention-search-results__check')
    expect(mentionSource).toContain("border-bottom-color: var(--color-accent)")
    expect(mentionSource).not.toContain("label: '页面元素'")
  })

  it('shows configured quick skills and invokes their default prompts', () => {
    expect(composerSource).toContain("call('claude.commandCatalog'")
    expect(composerSource).toContain('skill.quickInvocation')
    expect(composerSource).toContain('@click="invokeQuickSkill(skill)"')
    expect(composerSource).toContain('skill.defaultPrompt')
  })

  it('supports quick invocation while creating a skill', () => {
    expect(addSkillSource).toContain('v-model="quickInvocation"')
    expect(addSkillSource).toContain('v-model="defaultPrompt"')
    expect(addSkillSource).toContain('quickInvocation: quickInvocation.value')
  })
})
