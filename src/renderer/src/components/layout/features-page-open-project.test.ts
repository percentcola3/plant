import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./FeaturesPage.vue', import.meta.url), 'utf-8')

describe('FeaturesPage project open behavior', () => {
  it('opens project cards through the shared preview project context', () => {
    expect(source).toContain("import { createPreviewProjectContext } from '@/lib/preview/preview-project'")
    expect(source).toContain('async function openFeatureProject(card: FeatureCard): Promise<void>')
    expect(source).toContain('const project = createPreviewProjectContext(')
    expect(source).toContain("'uiProduct.seedAgentFiles'")
    expect(source).toContain('productRelPath: card.relPath')
    expect(source).toContain('previewStore.openProject({')
    expect(source).toContain('primaryRelPath: primaryUi?.htmlRelPath ?? card.prdRelPath ?? undefined')
    expect(source).toContain('@click="openFeatureProject(card)"')
    expect(source).toContain('@keydown.enter.prevent="openFeatureProject(card)"')
    expect(source).not.toContain('openAiForFeature')
    expect(source).not.toContain('AI 对话')
  })
})
