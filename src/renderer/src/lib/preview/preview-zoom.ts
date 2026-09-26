export const PREVIEW_ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

export const PREVIEW_ZOOM_DEFAULT = 1

export const PREVIEW_ZOOM_MIN_PERCENT = 10
export const PREVIEW_ZOOM_MAX_PERCENT = 500

export function formatPreviewZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

export function parsePreviewZoomPercent(raw: string): number | null {
  const cleaned = raw.trim().replace(/%/g, '')
  if (!cleaned) return null
  const percent = Number.parseFloat(cleaned)
  if (!Number.isFinite(percent)) return null
  if (percent < PREVIEW_ZOOM_MIN_PERCENT || percent > PREVIEW_ZOOM_MAX_PERCENT) return null
  return percent / 100
}

export function nearestPreviewZoomPresetIndex(zoom: number): number {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  PREVIEW_ZOOM_PRESETS.forEach((preset, index) => {
    const distance = Math.abs(preset - zoom)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

export function stepPreviewZoom(zoom: number, delta: number): number {
  const index = nearestPreviewZoomPresetIndex(zoom)
  const nextIndex = Math.min(
    PREVIEW_ZOOM_PRESETS.length - 1,
    Math.max(0, index + delta),
  )
  return PREVIEW_ZOOM_PRESETS[nextIndex]
}
