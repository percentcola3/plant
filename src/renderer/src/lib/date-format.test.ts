import { describe, expect, it } from 'vitest'
import { formatDateTimeMinute } from './date-format'

describe('date format helpers', () => {
  it('formats dates as yyyy-mm-dd hh:mm', () => {
    expect(formatDateTimeMinute(new Date(2026, 5, 18, 9, 49, 30))).toBe('2026-06-18 09:49')
  })

  it('returns fallback for invalid dates', () => {
    expect(formatDateTimeMinute('not-a-date', '未知时间')).toBe('未知时间')
  })
})
