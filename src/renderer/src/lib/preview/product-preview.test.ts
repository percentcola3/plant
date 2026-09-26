import { describe, expect, it } from 'vitest'
import {
  createDefaultProductMeta,
  getCurrentDisplayPreviewSize,
  isWorkbenchCanvasPresetActive,
  matchWorkbenchCanvasPreset,
  shouldReloadProductPreview,
  WORKBENCH_CANVAS_PRESETS,
} from './product-preview'

describe('product preview helpers', () => {
  it('opens product previews on the default 1440×900 canvas preset', () => {
    const meta = createDefaultProductMeta('ui/login')

    expect(meta.responsive).toBe(false)
    expect(meta.devicePreset).toBe('1440×900')
    expect(meta.deviceWidth).toBe(1440)
    expect(meta.deviceHeight).toBe(900)
  })

  it('matches active workbench canvas presets by fixed width and height', () => {
    const preset = WORKBENCH_CANVAS_PRESETS[1]
    expect(preset.kind).toBe('phone')
    expect(isWorkbenchCanvasPresetActive({
      deviceWidth: 750,
      deviceHeight: 1624,
      responsive: false,
      rotate: false,
    }, preset)).toBe(true)
    expect(matchWorkbenchCanvasPreset({
      deviceWidth: 1440,
      deviceHeight: 900,
      responsive: false,
      rotate: false,
    })?.kind).toBe('desktop')
  })

  it('prefers display resolution over available work area size', () => {
    expect(getCurrentDisplayPreviewSize({
      width: 1940,
      height: 1440,
      availWidth: 1900,
      availHeight: 1390
    })).toEqual({ width: 1940, height: 1440 })
  })

  it('reloads when a changed file belongs to an open product', () => {
    expect(shouldReloadProductPreview(
      'ui/login/style.css',
      ['ui/login']
    )).toBe(true)
  })

  it('ignores unrelated file changes', () => {
    expect(shouldReloadProductPreview(
      'docs/note.md',
      ['ui/login']
    )).toBe(false)
  })
})
