export type SurfaceRect = { left: number; top: number; right: number; bottom: number }
export function rectanglesOverlap(a: SurfaceRect, b: SurfaceRect): boolean {
  return a.right > a.left && a.bottom > a.top && b.right > b.left && b.bottom > b.top
    && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}
export function browserOverlayVisible(element: Element, surface: SurfaceRect): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [data-state="closed"]')) return false
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false
  return [...element.getClientRects()].some(rect => rectanglesOverlap(surface, rect))
}
