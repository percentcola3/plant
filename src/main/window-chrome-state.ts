import { BrowserWindow, screen } from 'electron'

export type WindowChromeState = {
  platform: string
  maximized: boolean
  fullscreen: boolean
  compactTrafficLightInset: boolean
}

type Rect = { x: number; y: number; width: number; height: number }

let mainWindowRef: BrowserWindow | null = null

export function setMainWindowRef(win: BrowserWindow | null): void {
  mainWindowRef = win
}

export function resolveMainBrowserWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef
  return BrowserWindow.getAllWindows().find((win) => {
    if (win.isDestroyed()) return false
    const { width, height } = win.getBounds()
    return width > 200 && height > 200
  }) ?? null
}

export function matchesWorkArea(bounds: Rect, area: Rect, tolerance = 8): boolean {
  return (
    Math.abs(bounds.x - area.x) <= tolerance
    && Math.abs(bounds.y - area.y) <= tolerance
    && Math.abs(bounds.width - area.width) <= tolerance
    && Math.abs(bounds.height - area.height) <= tolerance
  )
}

// On macOS with titleBarStyle: 'hiddenInset', the green zoom button sets the
// window bounds to cover the menu bar (y=0) while workArea.y = menu bar height (~25-38px).
// We compare width first (must be close), then height loosely (allow window to
// extend under menu bar by up to 60px) and ignore y entirely.
export function isWindowExpanded(win: BrowserWindow): boolean {
  if (win.isFullScreen()) return true
  if (win.isMaximized()) return true
  if (process.platform !== 'darwin') return false

  const bounds = win.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea

  const widthMatch = Math.abs(bounds.width - area.width) <= 16
  const heightMatch = bounds.height >= area.height - 16

  return widthMatch && heightMatch
}

export function getWindowChromeState(win: BrowserWindow): WindowChromeState {
  const fullscreen = win.isFullScreen()
  const expanded = isWindowExpanded(win)
  return {
    platform: process.platform,
    maximized: expanded,
    fullscreen,
    compactTrafficLightInset: process.platform === 'darwin' && expanded,
  }
}

export function sendWindowChromeState(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('window.chrome-state', getWindowChromeState(win))
}

export function attachWindowChromeStateEvents(win: BrowserWindow): void {
  const notify = () => sendWindowChromeState(win)
  win.on('maximize', notify)
  win.on('unmaximize', notify)
  win.on('enter-full-screen', notify)
  win.on('leave-full-screen', notify)
  win.on('resize', notify)
  win.on('move', notify)
  win.webContents.on('did-finish-load', notify)
}
