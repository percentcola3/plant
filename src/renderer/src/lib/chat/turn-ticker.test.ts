import { describe, it, expect } from 'vitest'
import { pickRotatingLabel, formatElapsed, ROTATING_LABELS } from './turn-ticker'

describe('pickRotatingLabel', () => {
  it('returns the first label at start', () => {
    expect(pickRotatingLabel(0)).toBe(ROTATING_LABELS[0])
  })

  it('rotates every 3 seconds', () => {
    expect(pickRotatingLabel(2)).toBe(ROTATING_LABELS[0])
    expect(pickRotatingLabel(3)).toBe(ROTATING_LABELS[1])
    expect(pickRotatingLabel(6)).toBe(ROTATING_LABELS[2])
  })

  it('wraps around the label list', () => {
    const len = ROTATING_LABELS.length
    expect(pickRotatingLabel(len * 3)).toBe(ROTATING_LABELS[0])
    expect(pickRotatingLabel(len * 3 + 4)).toBe(ROTATING_LABELS[1])
  })

  it('clamps negative seconds to first label', () => {
    expect(pickRotatingLabel(-5)).toBe(ROTATING_LABELS[0])
  })
})

describe('formatElapsed', () => {
  it('formats sub-minute as "Ns"', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(45)).toBe('45s')
  })

  it('formats minute-plus as "Mm SSs" (zero-padded seconds)', () => {
    expect(formatElapsed(60)).toBe('1m 00s')
    expect(formatElapsed(125)).toBe('2m 05s')
    expect(formatElapsed(3661)).toBe('61m 01s')
  })

  it('floors fractional seconds', () => {
    expect(formatElapsed(2.9)).toBe('2s')
  })
})
