import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserOverlayVisible, rectanglesOverlap } from './browser-visibility'
const surface = { left: 200, top: 100, right: 900, bottom: 700 }
afterEach(() => vi.unstubAllGlobals())
describe('native webpage overlay visibility', () => {
  it('does not hide a webpage for menus outside its content area or zero-sized elements', () => {
    expect(rectanglesOverlap(surface, { left: 0, top: 0, right: 180, bottom: 500 })).toBe(false)
    expect(rectanglesOverlap(surface, { left: 200, top: 100, right: 200, bottom: 400 })).toBe(false)
    expect(rectanglesOverlap(surface, { left: 250, top: 200, right: 600, bottom: 500 })).toBe(true)
  })
  it('ignores closed or invisible overlays while respecting an actual overlapping menu', () => {
    const element = { closest: vi.fn(() => null), getClientRects: () => [surface] } as unknown as Element
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
    expect(browserOverlayVisible(element, surface)).toBe(true)
    vi.mocked(element.closest).mockReturnValue({} as Element)
    expect(browserOverlayVisible(element, surface)).toBe(false)
    vi.mocked(element.closest).mockReturnValue(null)
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'hidden', opacity: '1' }))
    expect(browserOverlayVisible(element, surface)).toBe(false)
  })
})
