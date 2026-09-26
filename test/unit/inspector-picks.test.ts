import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInspectorPicksStore } from '@/stores/inspector-picks'

describe('inspector-picks store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('sync 全量替换', () => {
    const store = useInspectorPicksStore()
    store.sync('tab-1', [
      { alias: 'A', path: 'div.card' },
      { alias: 'B', path: 'span.title' }
    ])
    expect(store.currentPicks).toHaveLength(0) // 没设 activeTabId

    store.setActiveTab('tab-1')
    expect(store.currentPicks).toHaveLength(2)
    expect(store.currentPicks[0].alias).toBe('A')
    expect(store.currentPicks[1].path).toBe('span.title')
  })

  it('findByPath 命中/未命中', () => {
    const store = useInspectorPicksStore()
    store.sync('tab-1', [{ alias: 'A', path: 'div.card' }])

    expect(store.findByPath('tab-1', 'div.card')).not.toBeNull()
    expect(store.findByPath('tab-1', 'div.missing')).toBeNull()
    expect(store.findByPath('other-tab', 'div.card')).toBeNull()
  })

  it('多 tabId 隔离', () => {
    const store = useInspectorPicksStore()
    store.sync('tab-1', [{ alias: 'A', path: 'div.a' }])
    store.sync('tab-2', [{ alias: 'A', path: 'div.b' }])

    store.setActiveTab('tab-1')
    expect(store.currentPicks[0].path).toBe('div.a')

    store.setActiveTab('tab-2')
    expect(store.currentPicks[0].path).toBe('div.b')
  })

  it('clearTab 不影响其他 tab', () => {
    const store = useInspectorPicksStore()
    store.sync('tab-1', [{ alias: 'A', path: 'div.a' }])
    store.sync('tab-2', [{ alias: 'B', path: 'div.b' }])

    store.clearTab('tab-1')
    expect(store.findByPath('tab-1', 'div.a')).toBeNull()
    expect(store.findByPath('tab-2', 'div.b')).not.toBeNull()
  })
})
