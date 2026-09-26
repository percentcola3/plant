import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setBounds, showInactive, moveTop, getAllWindows } = vi.hoisted(() => {
  const setBounds = vi.fn()
  const showInactive = vi.fn()
  const moveTop = vi.fn()
  return {
    setBounds,
    showInactive,
    moveTop,
    getAllWindows: vi.fn(() => [{
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: -1080, width: 620, height: 360 }),
      setBounds,
      showInactive,
      moveTop,
      webContents: { getURL: () => 'http://localhost/?window=ai-task-notch' }
    }])
  }
})

const preference = vi.hoisted(() => ({ aiTaskNotchEnabled: true }))
vi.mock('../settings/store', () => ({ settingsStore: { getCached: () => preference } }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1600, height: 1000 } }),
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1600, height: 1000 } }),
    getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1600, height: 1000 } })
  }
}))

import {
  normalizeAiTaskNotchPanelHeight,
  presentAiTaskNotch,
  setAiTaskNotchPanelHeight,
  setAiTaskNotchState
} from './notch-window'

describe('AI task notch panel height', () => {
  beforeEach(() => {
    preference.aiTaskNotchEnabled = true
    setBounds.mockClear()
    showInactive.mockClear()
    moveTop.mockClear()
    setAiTaskNotchState('mini')
    setBounds.mockClear()
  })

  it('clamps measured panel height to the safe range', () => {
    expect(normalizeAiTaskNotchPanelHeight(90)).toBe(130)
    expect(normalizeAiTaskNotchPanelHeight(211.2)).toBe(212)
    expect(normalizeAiTaskNotchPanelHeight(500)).toBe(360)
    expect(normalizeAiTaskNotchPanelHeight(Number.NaN)).toBe(360)
  })

  it('applies measured height only while the notch is expanded', () => {
    setAiTaskNotchPanelHeight(200)
    expect(setBounds).not.toHaveBeenCalled()

    setAiTaskNotchState('panel')
    setBounds.mockClear()
    setAiTaskNotchPanelHeight(200)

    expect(setBounds).toHaveBeenCalledWith({
      x: 100,
      y: -1080,
      width: 620,
      height: 200
    })
  })
})

it('does not reshow a disabled notch for task alerts or expansion', () => {
  showInactive.mockClear()
  preference.aiTaskNotchEnabled = false
  presentAiTaskNotch()
  setAiTaskNotchState('panel')
  expect(showInactive).not.toHaveBeenCalled()
  preference.aiTaskNotchEnabled = true
  presentAiTaskNotch()
  expect(showInactive).toHaveBeenCalledOnce()
})
