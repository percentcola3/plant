export function reconcileTabOrder(previous: string[], available: string[]): string[] {
  return [...previous.filter(key => available.includes(key)), ...available.filter(key => !previous.includes(key))]
}
export function moveWorkbenchTab(order: string[], from: string, to: string): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return order
  const next = order.filter(key => key !== from)
  next.splice(next.indexOf(to), 0, from)
  return next
}
export function tabsToClose(order: string[], key: string, mode: 'left' | 'right' | 'others' | 'all'): string[] {
  const index = order.indexOf(key)
  if (index < 0) return []
  return order.filter((_, i) => mode === 'all' || (mode === 'left' ? i < index : mode === 'right' ? i > index : i !== index))
}
