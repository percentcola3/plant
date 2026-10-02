import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')
const appShellSources = [
  '../App.vue',
  '../components/layout/AddSkillForm.vue',
  '../components/layout/FeaturesPage.vue',
  '../components/layout/ProjectAiConfigPanel.vue',
  '../components/chat/ConversationView.vue'
].map((path) => readFileSync(resolve(__dirname, path), 'utf8')).join('\n')
const editorChromeSources = [
  '../components/editor/WorkspaceEditorPane.vue',
  '../components/preview/MarkdownTabPane.vue',
  '../components/preview/ProductFilesTabPane.vue'
].map((path) => readFileSync(resolve(__dirname, path), 'utf8')).join('\n')

describe('app shell theme tokens', () => {
  it('uses botanical dark palette with leaf-green primary buttons', () => {
    expect(css).toContain('color-scheme: dark;')
    expect(css).toContain('--background: 152 12% 7%;')
    expect(css).toContain('--card: 152 10% 10%;')
    expect(css).toContain('--color-bg-base: #101512;')
    expect(css).toContain('--color-bg-panel: #151b17;')
    expect(css).toContain('--color-bg-canvas: #0b0f0d;')
    expect(css).toContain('--color-text-primary: #e6ede8;')
    expect(css).toContain('--color-accent: #46c98b;')
    expect(css).toContain('--color-button-bg: #33b57e;')
    expect(css).toContain('--color-button-fg: #04160d;')
    // 叶绿色阶在暗/亮两套主题中成对定义
    expect(css).toContain('--color-leaf: #46c98b;')
    expect(css).toContain('--color-leaf: #1e8e5a;')

    expect(css).not.toContain('#0d1117')
    expect(css).not.toContain('#58a6ff')
    expect(css).not.toContain('#fffdf3')
    expect(css).not.toContain('#fdf6e3')
    expect(css).not.toContain('#66a962')
    expect(css).not.toContain('#0d99ff')
    expect(css).not.toContain('#0969da')
  })

  it('uses black button tokens for app shell primary actions', () => {
    expect(appShellSources).toContain('background: var(--color-button-bg);')
    expect(appShellSources).toContain('background: var(--color-bg-base);')

    for (const legacyColor of [
      '#ff6f31',
      '#4754aa',
      '#3a46a0',
      '#f26b2f',
      '#e75f25',
      'rgba(102, 169, 98, 0.14)',
      'rgba(102, 169, 98, 0.55)',
      'rgba(102, 169, 98, 0.2)'
    ]) {
      expect(appShellSources).not.toContain(legacyColor)
    }
  })

  it('keeps editor chrome flat and neutral', () => {
    expect(editorChromeSources).not.toContain('linear-gradient(135deg, #fffaf6')
    expect(editorChromeSources).not.toContain('bg-[linear-gradient(135deg,#fffaf6')
  })
})
