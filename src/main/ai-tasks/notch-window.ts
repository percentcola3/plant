import { settingsStore } from '../settings/store'
import { BrowserWindow, app, screen } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// 屏幕顶部常驻的灵动岛监控窗口（参考 OpenSource/vibe-notch NotchWindow.swift 的做法）。
//
// 关键点：
// 1. `alwaysOnTop: 'screen-saver'` + `visibleOnAllWorkspaces` —— 跨 workspace / 全屏 App 都能看到
// 2. `focusable: false` + `skipTaskbar: true` —— 不抢焦点、不进 Dock
// 3. **默认 `setIgnoreMouseEvents(true, { forward: true })`** —— 窗口完全透明地穿透鼠标事件到
//    下方窗口；但 mousemove 仍会 forward 到 renderer，让它能感知鼠标位置
// 4. Renderer 检测到鼠标进入实际图标 / 面板区域后，通过 IPC 请求主进程切换到
//    `setIgnoreMouseEvents(false)`，此时才接受点击；离开区域再切回 forward 模式
// 5. 两态：mini（44×44 透明窗口，容纳 36×36 图标和外置角标）/ panel（620×360 展开）
// 6. 位置持久化：用户拖动后记住 x,y 到 userData/notch-position.json；下次启动读回

export const AI_TASK_NOTCH_WINDOW_KIND = 'ai-task-notch'

export type NotchWindowState = 'mini' | 'panel'

const SIZES: Record<NotchWindowState, { width: number; height: number }> = {
  mini: { width: 44, height: 44 },
  panel: { width: 620, height: 360 }
}
const PANEL_MIN_HEIGHT = 130
const PANEL_MAX_HEIGHT = SIZES.panel.height
let currentNotchState: NotchWindowState = 'mini'

export function normalizeAiTaskNotchPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return PANEL_MAX_HEIGHT
  return Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.ceil(height)))
}
// y=0 贴屏幕最顶。若 MacBook 有物理刘海，窗口会与物理刘海位置重合，视觉上像
// 是灵动岛贴在刘海附近。macOS 会把顶部像素画到菜单栏之上（因为
// screen-saver 层级高于 menu bar）。
const DEFAULT_TOP_OFFSET = 0

// 位置持久化：只在用户手动拖动时写入；state 切换不重置。
type PersistedPosition = { x: number; y: number }
function positionFile(): string {
  return join(app.getPath('userData'), 'notch-position.json')
}
export async function readNotchPosition(): Promise<PersistedPosition | null> {
  try {
    const raw = await fs.readFile(positionFile(), 'utf-8')
    const parsed = JSON.parse(raw) as PersistedPosition
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed
    return null
  } catch { return null }
}
export async function writeNotchPosition(pos: PersistedPosition): Promise<void> {
  try {
    await fs.mkdir(join(app.getPath('userData')), { recursive: true }).catch(() => undefined)
    await fs.writeFile(positionFile(), JSON.stringify(pos), 'utf-8')
  } catch {
    // best-effort，写盘失败不影响运行
  }
}

export function isAiTaskNotchWindow(win: BrowserWindow): boolean {
  return win.webContents.getURL().includes(`window=${AI_TASK_NOTCH_WINDOW_KIND}`)
}

export function findAiTaskNotchWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find(isAiTaskNotchWindow) ?? null
}

// 把 bounds clamp 到鼠标所在屏幕的可视范围内。mini/panel 尺寸不同，
// 切态时窗口可能扩大反而溢出（比如 mini 拖到最右边再展开 panel）。
export function clampNotchBoundsToScreen(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point) ?? screen.getPrimaryDisplay()
  const area = display.bounds
  // 至少 2/3 在可视区
  const minX = area.x - Math.floor(bounds.width / 3)
  const minY = area.y
  const maxX = area.x + area.width - Math.ceil(bounds.width * 2 / 3)
  const maxY = area.y + area.height - Math.ceil(bounds.height * 2 / 3)
  return {
    x: Math.min(Math.max(bounds.x, minX), maxX),
    y: Math.min(Math.max(bounds.y, minY), maxY)
  }
}

// JS 驱动的相对拖动：renderer 侧监听 mousedown → mousemove，通过 IPC 让主进程
// 按 delta 累加窗口位置。用于 mini 和 panel 顶栏，让双击与拖动可以共存。
export function moveAiTaskNotchBy(dx: number, dy: number): void {
  const win = findAiTaskNotchWindow()
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const next = clampNotchBoundsToScreen({ ...b, x: b.x + Math.round(dx), y: b.y + Math.round(dy) })
  win.setBounds({ ...b, x: next.x, y: next.y })
}

// 应用窗口尺寸；位置默认屏幕顶部居中，若外部传了 preservePosition=true 就保留当前 x,y
// 但仍要 clamp（切态时新尺寸可能让当前 x,y 位置整体溢出）。
export function applyAiTaskNotchBounds(
  win: BrowserWindow,
  state: NotchWindowState,
  opts: { preservePosition?: boolean } = {}
): void {
  const size = SIZES[state]
  if (opts.preservePosition) {
    const current = win.getBounds()
    const clamped = clampNotchBoundsToScreen({ ...current, width: size.width, height: size.height })
    win.setBounds({ x: clamped.x, y: clamped.y, width: size.width, height: size.height })
    return
  }
  const display = screen.getDisplayMatching(win.getBounds()) ?? screen.getPrimaryDisplay()
  // 用 display.bounds（整块屏幕含菜单栏区域），不是 workArea（会从菜单栏下面开始）。
  // 灵动岛设计就是要贴在屏幕最顶，跟 macOS 物理刘海对齐。
  const bounds = display.bounds
  win.setBounds({
    x: Math.round(bounds.x + (bounds.width - size.width) / 2),
    y: bounds.y + DEFAULT_TOP_OFFSET,
    width: size.width,
    height: size.height
  })
}

// 同步应用持久化位置（如果有），维持当前尺寸。启动阶段调用。
export function applyAiTaskNotchPosition(win: BrowserWindow, pos: PersistedPosition): void {
  const current = win.getBounds()
  win.setBounds({ x: pos.x, y: pos.y, width: current.width, height: current.height })
}

// 切 mini/panel 两态：改尺寸但保留用户拖动过的位置。
// 之前实验过 setIgnoreMouseEvents click-through，副作用是 drag 失效 + IPC 延迟卡首次点击；
// mini 只占一个图标大小，panel 仅保留小幅阴影缓冲，阻挡区域可控；
// 不满意的话用户 mini 或拖走即可。所以整体常驻可点，不做穿透。
export function setAiTaskNotchState(state: NotchWindowState): void {
  currentNotchState = state
  const win = findAiTaskNotchWindow()
  if (!win || win.isDestroyed()) return
  applyAiTaskNotchBounds(win, state, { preservePosition: true })
  if (state !== 'mini') presentAiTaskNotch()
}

export function setAiTaskNotchPanelHeight(height: number): void {
  if (currentNotchState !== 'panel') return
  const win = findAiTaskNotchWindow()
  if (!win || win.isDestroyed()) return
  const current = win.getBounds()
  const nextHeight = normalizeAiTaskNotchPanelHeight(height)
  if (current.width === SIZES.panel.width && current.height === nextHeight) return
  win.setBounds({
    x: current.x,
    y: current.y,
    width: SIZES.panel.width,
    height: nextHeight
  })
}

export function presentAiTaskNotch(): void {
  if (settingsStore.getCached()?.aiTaskNotchEnabled === false) return
  const win = findAiTaskNotchWindow()
  if (!win || win.isDestroyed()) return
  win.showInactive()
  win.moveTop()
}
