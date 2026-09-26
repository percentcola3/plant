export const TERMINAL_RESIZE_MIN_WIDTH = 280
export const TERMINAL_RESIZE_MAX_VIEWPORT_RATIO = 0.7

export function calculateTerminalResizeWidth(input: {
  startX: number
  currentX: number
  startWidth: number
  viewportWidth: number
}): number {
  const maxWidth = input.viewportWidth * TERMINAL_RESIZE_MAX_VIEWPORT_RATIO
  const delta = input.startX - input.currentX
  return Math.min(maxWidth, Math.max(TERMINAL_RESIZE_MIN_WIDTH, input.startWidth + delta))
}
