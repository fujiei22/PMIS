import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dayFraction, dayIndex, isoFromIndex, lengthOf, shiftMonth, todayIndex } from '@/lib/date'

describe('date', () => {
  it('dayIndex 與 isoFromIndex 互為反函式', () => {
    const i = dayIndex('2026-09-18')
    expect(i).toBe(Math.floor(Date.parse('2026-09-18T00:00:00Z') / 86400000))
    expect(isoFromIndex(i)).toBe('2026-09-18')
  })

  it('todayIndex 由毫秒換算成日索引', () => {
    expect(todayIndex(new Date(2026, 8, 18, 10, 0).getTime())).toBe(dayIndex('2026-09-18'))
  })

  it('todayIndex 整天都回同一個日索引（本地日，不因時區偏移跨日）', () => {
    const expected = dayIndex('2026-09-19')
    expect(todayIndex(new Date(2026, 8, 19, 0, 5).getTime())).toBe(expected)
    expect(todayIndex(new Date(2026, 8, 19, 7, 30).getTime())).toBe(expected)
    expect(todayIndex(new Date(2026, 8, 19, 23, 55).getTime())).toBe(expected)
  })

  // review M2：legacy :1893 的 todayIdx 用 UTC 日，UTC+8 每天 00:00-08:00 會判成昨天。
  describe('固定在 Asia/Taipei（UTC+8）', () => {
    const origin = process.env.TZ
    beforeAll(() => {
      process.env.TZ = 'Asia/Taipei'
    })
    afterAll(() => {
      process.env.TZ = origin
    })

    it('UTC+8 早上 07:00 算今天，不是昨天', () => {
      // 2026-09-19T07:00+08:00 === 2026-09-18T23:00Z；舊的 UTC 版本會回 09-18
      const now = Date.parse('2026-09-18T23:00:00Z')
      expect(new Date(now).getHours()).toBe(7)
      expect(todayIndex(now)).toBe(dayIndex('2026-09-19'))
    })

    it('UTC+8 深夜 23:00 仍算當天', () => {
      // 2026-09-19T23:00+08:00 === 2026-09-19T15:00Z
      expect(todayIndex(Date.parse('2026-09-19T15:00:00Z'))).toBe(dayIndex('2026-09-19'))
    })
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
