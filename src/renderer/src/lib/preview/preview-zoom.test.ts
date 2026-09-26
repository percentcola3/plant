import { describe, expect, it } from 'vitest'
import {
  PREVIEW_ZOOM_DEFAULT,
  parsePreviewZoomPercent,
  stepPreviewZoom,
} from './preview-zoom'

describe('preview zoom', () => {
  it('steps through preset zoom levels', () => {
    expect(stepPreviewZoom(1, -1)).toBe(0.75)
    expect(stepPreviewZoom(1, 1)).toBe(1.25)
    expect(stepPreviewZoom(0.25, -1)).toBe(0.25)
    expect(stepPreviewZoom(2, 1)).toBe(2)
  })

  it('parses editable zoom percentages', () => {
    expect(parsePreviewZoomPercent('100%')).toBe(1)
    expect(parsePreviewZoomPercent('125')).toBe(1.25)
    expect(parsePreviewZoomPercent('9%')).toBeNull()
  })

  it('uses 100% as the default reset value', () => {
    expect(PREVIEW_ZOOM_DEFAULT).toBe(1)
  })
})
