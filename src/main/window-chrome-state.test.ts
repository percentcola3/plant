import { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isWindowExpanded, matchesWorkArea } from './window-chrome-state'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 38, width: 1728, height: 1006 },
    })),
  },
}))

function makeMockWin(overrides: {
  isFullScreen?: boolean
  isMaximized?: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}) {
  return {
    isFullScreen: vi.fn(() => overrides.isFullScreen ?? false),
    isMaximized: vi.fn(() => overrides.isMaximized ?? false),
    getBounds: vi.fn(() => overrides.bounds ?? { x: 0, y: 0, width: 1728, height: 1044 }),
  } as unknown as BrowserWindow
}

describe('matchesWorkArea', () => {
  it('treats bounds matching the work area as a match', () => {
    const workArea = { x: 0, y: 38, width: 1728, height: 1006 }
    expect(matchesWorkArea(workArea, workArea)).toBe(true)
    expect(matchesWorkArea({ ...workArea, width: 1720 }, workArea)).toBe(true)
  })

  it('does not match smaller windows', () => {
    const workArea = { x: 0, y: 38, width: 1728, height: 1006 }
    expect(matchesWorkArea({ x: 120, y: 80, width: 1280, height: 800 }, workArea)).toBe(false)
  })
})

describe('isWindowExpanded', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when isFullScreen', () => {
    const win = makeMockWin({ isFullScreen: true })
    expect(isWindowExpanded(win)).toBe(true)
  })

  it('returns true when isMaximized', () => {
    const win = makeMockWin({ isMaximized: true })
    expect(isWindowExpanded(win)).toBe(true)
  })

  it('returns true when zoomed via green button (y=0, height extends under menu bar)', () => {
    // macOS green-button zoom: window starts at y=0, height = workArea.height + menuBarHeight
    const win = makeMockWin({ bounds: { x: 0, y: 0, width: 1728, height: 1044 } })
    expect(isWindowExpanded(win)).toBe(true)
  })

  it('returns false for a small floating window', () => {
    const win = makeMockWin({ bounds: { x: 120, y: 80, width: 1280, height: 800 } })
    expect(isWindowExpanded(win)).toBe(false)
  })
})
