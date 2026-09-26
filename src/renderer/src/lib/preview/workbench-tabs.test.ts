import { describe, expect, it } from 'vitest'
import { reconcileTabOrder, moveWorkbenchTab, tabsToClose } from './workbench-tabs'
describe('mixed file and webpage tabs', () => {
  const order = ['file:a', 'web:1', 'file:b', 'web:2']
  it('retains mixed order across page updates and appends newly opened files', () => {
    expect(reconcileTabOrder(order, ['file:a', 'file:b', 'file:c', 'web:2'])).toEqual(['file:a', 'file:b', 'web:2', 'file:c'])
  })
  it('reorders files and webpages on the same strip', () => {
    expect(moveWorkbenchTab(order, 'web:2', 'file:a')).toEqual(['web:2', 'file:a', 'web:1', 'file:b'])
    expect(moveWorkbenchTab(order, 'closed', 'file:a')).toEqual(order)
  })
  it('uses displayed order for all bulk close actions', () => {
    expect(tabsToClose(order, 'file:b', 'left')).toEqual(['file:a', 'web:1'])
    expect(tabsToClose(order, 'file:b', 'right')).toEqual(['web:2'])
    expect(tabsToClose(order, 'file:b', 'others')).toEqual(['file:a', 'web:1', 'web:2'])
    expect(tabsToClose(order, 'file:b', 'all')).toEqual(order)
    expect(tabsToClose(order, 'closed', 'all')).toEqual([])
  })
})
