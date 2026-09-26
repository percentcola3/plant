import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const homeSource = readFileSync(new URL('./WorkbenchHome.vue', import.meta.url), 'utf-8')
const featuresSource = readFileSync(new URL('./FeaturesPage.vue', import.meta.url), 'utf-8')
const resourcePanelSource = readFileSync(new URL('./ProjectAiConfigPanel.vue', import.meta.url), 'utf-8')
const dialogSource = readFileSync(new URL('../dialogs/FeatureResourceDialog.vue', import.meta.url), 'utf-8')
const dropdownSource = readFileSync(new URL('../resources/FeatureResourceDropdown.vue', import.meta.url), 'utf-8')
const editorSource = readFileSync(new URL('../preview/ProductFilesTabPane.vue', import.meta.url), 'utf-8')

describe('project resource association', () => {
  it('supports multi-select knowledge and UX resources with optional defaults', () => {
    expect(dialogSource).toContain('v-for="resource in knowledgeResources"')
    expect(dialogSource).toContain('v-for="resource in uxResources"')
    expect(dialogSource).toContain('设为默认关联')
    expect(dialogSource).toContain('externalRefIds: [...draftIds.value]')
    expect(dropdownSource).toContain('v-for="resource in knowledgeResources"')
    expect(dropdownSource).toContain('v-for="resource in uxResources"')
    expect(dropdownSource).not.toContain('设为默认关联')
    expect(dropdownSource).not.toContain('已选择')
    expect(dropdownSource).toContain('前端知识库')
    expect(dropdownSource).toContain('feature-resource-dropdown__option--disabled')
  })

  it('passes clone-safe resource arrays from every IPC entry', () => {
    expect(homeSource).toContain('externalRefIds: [...selectedExternalRefIds.value]')
    expect(homeSource).toContain('setResourcesAsDefault: setResourcesAsDefault.value')
    expect(homeSource).toContain('<FeatureResourceDropdown')
    expect(featuresSource).toContain('externalRefIds: [...payload.externalRefIds]')
    expect(featuresSource).toContain('setResourcesAsDefault: payload.setAsDefault')
    expect(editorSource).toContain('externalRefIds: [...payload.externalRefIds]')
    expect(featuresSource).toContain('<FeatureResourceDialog')
  })

  it('allows resource changes from the project editor', () => {
    expect(editorSource).toContain("call('feature.resources.get'")
    expect(editorSource).toContain("call('feature.resources.update'")
    expect(editorSource).toContain('调整项目资源')
  })

  it('renders every attached UX resource as its own card', () => {
    expect(resourcePanelSource).toContain('v-for="item in projectUikitBindings"')
    expect(resourcePanelSource).not.toContain('projectUikitBinding.value')
  })
})
