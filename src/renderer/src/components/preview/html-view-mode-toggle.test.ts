import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('HtmlViewModeToggle', () => {
  const source = readFileSync(
    resolve('src/renderer/src/components/preview/HtmlViewModeToggle.vue'),
    'utf8'
  )

  it('uses a dark track with an active chip only on the selected mode', () => {
    expect(source).toContain('product-workbench-icon-btn')
    expect(source).toContain('is-active')
    expect(source).toContain('MonitorPlay')
    expect(source).toContain('CodeXml')
    expect(source).toContain('background: var(--color-bg-canvas)')
    expect(source).toContain('background: transparent')
    expect(source).toContain('.product-workbench-icon-btn.is-active)')
    expect(source).toContain('background: var(--color-bg-hover)')
    expect(source).not.toContain('border: 1px solid var(--color-popover-border)')
    expect(source).toContain('gap: 4px')
    expect(source).toContain('border-radius: 8px')
    expect(source).toContain('width: 28px')
    expect(source).toContain('height: 24px')
  })
})
