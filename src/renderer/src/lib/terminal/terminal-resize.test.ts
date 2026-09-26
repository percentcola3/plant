import { describe, expect, it } from 'vitest'
import { calculateTerminalResizeWidth } from './terminal-resize'

describe('calculateTerminalResizeWidth', () => {
  it('向左拖动时增加终端宽度', () => {
    expect(calculateTerminalResizeWidth({
      startX: 800,
      currentX: 720,
      startWidth: 420,
      viewportWidth: 1200
    })).toBe(500)
  })

  it('不会小于最小宽度', () => {
    expect(calculateTerminalResizeWidth({
      startX: 800,
      currentX: 1200,
      startWidth: 420,
      viewportWidth: 1200
    })).toBe(280)
  })

  it('不会超过视口宽度的 70%', () => {
    expect(calculateTerminalResizeWidth({
      startX: 800,
      currentX: 0,
      startWidth: 420,
      viewportWidth: 1000
    })).toBe(700)
  })
})
