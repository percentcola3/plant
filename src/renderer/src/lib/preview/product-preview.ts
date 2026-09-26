export type ProductPreviewMeta = {
  path: string
  deviceWidth: number
  deviceHeight: number
  devicePreset: string
  responsive: boolean
  rotate: boolean
  zoom: number
}

export type WorkbenchCanvasPreset = {
  id: string
  width: number
  height: number
  label: string
  kind: 'desktop' | 'phone'
}

export const WORKBENCH_CUSTOM_DEVICE_PRESET = '自定义'

/** 工作台快捷画布尺寸（桌面 / 手机 icon 一键切换）。 */
export const WORKBENCH_CANVAS_PRESETS: WorkbenchCanvasPreset[] = [
  { id: '1440×900', width: 1440, height: 900, label: '1440×900', kind: 'desktop' },
  { id: '750×1624', width: 750, height: 1624, label: '750×1624', kind: 'phone' },
]

export function isWorkbenchCanvasPresetActive(
  meta: Pick<ProductPreviewMeta, 'deviceWidth' | 'deviceHeight' | 'responsive' | 'rotate'>,
  preset: WorkbenchCanvasPreset
): boolean {
  return !meta.responsive
    && !meta.rotate
    && meta.deviceWidth === preset.width
    && meta.deviceHeight === preset.height
}

export function matchWorkbenchCanvasPreset(
  meta: Pick<ProductPreviewMeta, 'deviceWidth' | 'deviceHeight' | 'responsive' | 'rotate'>
): WorkbenchCanvasPreset | null {
  return WORKBENCH_CANVAS_PRESETS.find(preset => isWorkbenchCanvasPresetActive(meta, preset)) ?? null
}

export function isWorkbenchCanvasMoreActive(
  meta: Pick<ProductPreviewMeta, 'deviceWidth' | 'deviceHeight' | 'devicePreset' | 'responsive' | 'rotate'>
): boolean {
  if (matchWorkbenchCanvasPreset(meta)) return false
  return true
}

export type PreviewDisplaySize = {
  width?: number
  height?: number
}

type ScreenLike = {
  availWidth?: number
  availHeight?: number
  width?: number
  height?: number
}

const FALLBACK_DISPLAY_SIZE = {
  width: 1440,
  height: 900
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.round(value) : fallback
}

export function normalizePreviewDisplaySize(size?: PreviewDisplaySize | null): Required<PreviewDisplaySize> {
  return {
    width: normalizeDimension(size?.width, FALLBACK_DISPLAY_SIZE.width),
    height: normalizeDimension(size?.height, FALLBACK_DISPLAY_SIZE.height)
  }
}

export function getCurrentDisplayPreviewSize(screenLike?: ScreenLike | null): Required<PreviewDisplaySize> {
  const screen = screenLike ?? (globalThis as { screen?: ScreenLike }).screen
  return normalizePreviewDisplaySize({
    width: screen?.width ?? screen?.availWidth,
    height: screen?.height ?? screen?.availHeight
  })
}

export function createDefaultProductMeta(
  path: string,
  _displaySize: PreviewDisplaySize = getCurrentDisplayPreviewSize()
): ProductPreviewMeta {
  const preset = WORKBENCH_CANVAS_PRESETS[0]
  return {
    path,
    deviceWidth: preset.width,
    deviceHeight: preset.height,
    devicePreset: preset.id,
    responsive: false,
    rotate: false,
    zoom: 1
  }
}

export function shouldReloadProductPreview(changedRelPath: string, productPaths: string[]): boolean {
  const rel = changedRelPath.replace(/\\/g, '/').replace(/^\/+/, '')
  return productPaths.some((path) => {
    const productPath = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    return rel === productPath || rel.startsWith(`${productPath}/`)
  })
}
