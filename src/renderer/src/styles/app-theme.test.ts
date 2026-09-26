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
  it('uses neutral dark palette with inverted primary buttons', () => {
    expect(css).toContain('color-scheme: dark;')
    expect(css).toContain('--background: 0 0% 7%;')
    expect(css).toContain('--card: 0 0% 10%;')
    expect(css).toContain('--color-bg-base: #121212;')
    expect(css).toContain('--color-bg-panel: #1a1a1a;')
    expect(css).toContain('--color-bg-canvas: #0a0a0a;')
    expect(css).toContain('--color-text-primary: #ececec;')
    expect(css).toContain('--color-accent: #d4d4d4;')
    expect(css).toContain('--color-button-bg: #f5f5f5;')
    expect(css).toContain('--color-button-fg: #121212;')

    expect(css).not.toContain('#0d1117')
    expect(css).not.toContain('#58a6ff')
    expect(css).not.toContain('#fffdf3')
    expect(css).not.toContain('#fdf6e3')
    expect(css).not.toContain('#66a962')
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
