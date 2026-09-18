import { describe, expect, it } from 'vitest'
import { dayFraction, dayIndex, isoFromIndex, lengthOf, shiftMonth, todayIndex } from '@/lib/date'

describe('date', () => {
  it('dayIndex 與 isoFromIndex 互為反函式', () => {
    const i = dayIndex('2026-09-18')
    expect(i).toBe(Math.floor(Date.parse('2026-09-18T00:00:00Z') / 86400000))
    expect(isoFromIndex(i)).toBe('2026-09-18')
  })

  it('todayIndex 由毫秒換算成日索引', () => {
    expect(todayIndex(Date.parse('2026-09-18T10:00:00Z'))).toBe(dayIndex('2026-09-18'))
  })

  it('lengthOf 的工期含頭尾兩天', () => {
    expect(lengthOf({ start: '2026-09-01', end: '2026-09-05' })).toBe(5)
    expect(lengthOf({ start: '2026-09-01', end: '2026-09-01' })).toBe(1)
  })

  it('shiftMonth 可跨年', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 2)).toBe('2027-02')
    expect(shiftMonth('2026-09-18', 0)).toBe('2026-09')
  })

  it('dayFraction 夾在 0 到 1 之間', () => {
    expect(dayFraction(new Date(2026, 8, 18, 8, 30))).toBe(0)
    expect(dayFraction(new Date(2026, 8, 18, 18, 30))).toBe(1)
    expect(dayFraction(new Date(2026, 8, 18, 13, 30))).toBeCloseTo(0.5, 5)
    expect(dayFraction(new Date(2026, 8, 18, 3, 0))).toBe(0)
    expect(dayFraction(new Date(2026, 8, 18, 23, 0))).toBe(1)
  })

  it('dayFraction 的工時區間顛倒時回 0', () => {
    expect(dayFraction(new Date(2026, 8, 18, 13, 0), 18, 9)).toBe(0)
  })
})
