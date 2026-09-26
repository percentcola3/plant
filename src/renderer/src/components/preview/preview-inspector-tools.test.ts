import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PreviewInspectorTools', () => {
  const toolsSource = readFileSync(new URL('./PreviewInspectorTools.vue', import.meta.url), 'utf-8')
  const moreSource = readFileSync(new URL('./PreviewInspectorMoreMenu.vue', import.meta.url), 'utf-8')
  const panelSource = readFileSync(new URL('./ElementTuningPanel.vue', import.meta.url), 'utf-8')
  const surfaceSource = readFileSync(new URL('./HtmlPreviewSurface.vue', import.meta.url), 'utf-8')

  it('separates element selection and element tuning controls', () => {
    expect(toolsSource).toContain('preview-inspector-tools')
    expect(toolsSource).not.toContain('border: 1px solid var(--color-popover-border)')
    expect(toolsSource).toContain('--color-text-secondary')
    expect(toolsSource).toContain('SquareDashedMousePointer')
    expect(toolsSource).toContain('SlidersHorizontal')
    expect(toolsSource).toContain("emit('pick-element')")
    expect(toolsSource).toContain("emit('toggle-element-edit')")
    expect(toolsSource).toContain('PreviewInspectorMoreMenu')
  })

  it('exposes preview file actions in the more menu', () => {
    expect(moreSource).toContain('PreviewZoomStepper')
    expect(moreSource).toContain('Ellipsis')
    expect(moreSource).toContain('aria-label="更多操作"')
    expect(moreSource).toContain('展示元素备注')
    expect(moreSource).toContain('在浏览器中打开')
    expect(moreSource).toContain('在 Finder 中显示')
  })

  it('renders tuning as a fixed full-height sibling of the preview viewport', () => {
    expect(surfaceSource).toContain('class="html-preview-workspace"')
    expect(surfaceSource).toContain('<ElementTuningPanel')
    expect(surfaceSource).toContain('v-if="elementEditing"')
    expect(panelSource).toContain('height: 100%')
    expect(panelSource).toContain('border-left: 1px solid var(--color-border)')
    expect(panelSource).not.toContain('position: fixed')
    expect(panelSource).not.toContain('position: absolute')
  })

  it('lets the tuning panel edit text, typography, flex layout and spacing', () => {
    expect(panelSource).toContain("'apply-text': [value: string]")
    expect(panelSource).toContain('文字内容')
    expect(panelSource).toContain("applyLength('font-size'")
    expect(panelSource).toContain("applyRaw('text-align'")
    expect(panelSource).toContain("applyRaw('display'")
    expect(panelSource).toContain("applyRaw('flex-direction'")
    expect(panelSource).toContain("applyRaw('justify-content'")
    expect(panelSource).toContain("applyRaw('align-items'")
    expect(panelSource).toContain("applyRaw('flex-grow'")
    expect(panelSource).toContain("applyLength('gap'")
    expect(panelSource).toContain("applyLength('padding'")
    expect(panelSource).toContain("applyLength('margin'")
    expect(surfaceSource).toContain('@apply-text="postElementText"')
  })
})
