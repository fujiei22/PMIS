import { describe, expect, it } from 'vitest'
import {
  EMPTY_LABEL,
  fileSize,
  fmtDate,
  fmtMoney,
  fmtMoneyShort,
  fmtWorkdays,
  fmtYears,
  shortDate,
  stripYear,
  visualLen,
} from '@/lib/format'

describe('format', () => {
  it('fmtDate 空字串回「選擇日期」', () => {
    expect(fmtDate('')).toBe('選擇日期')
  })

  it('fmtDate 補零成 YYYY/MM/DD', () => {
    expect(fmtDate('2026-09-08')).toBe('2026/09/08')
    expect(fmtDate('2026-9-8')).toBe('2026/09/08')
    expect(fmtDate('2026-12-31')).toBe('2026/12/31')
  })

  it('shortDate 只留 MM/DD', () => {
    expect(shortDate('2026-09-08')).toBe('09/08')
    expect(shortDate('2026-12-31')).toBe('12/31')
  })

  it('stripYear 去掉年份', () => {
    expect(stripYear('2026/09/08')).toBe('09/08')
    expect(stripYear('09/08')).toBe('09/08')
  })

  it('visualLen 中文算 1、英數算 0.5', () => {
    expect(visualLen('前端框架建置')).toBe(6)
    expect(visualLen('abcd')).toBe(2)
    expect(visualLen('前端 API')).toBeCloseTo(4, 5)
    expect(visualLen('')).toBe(0)
  })

  it('fileSize 三段換算', () => {
    expect(fileSize(512)).toBe('512 B')
    expect(fileSize(1024)).toBe('1 KB')
    expect(fileSize(428000)).toBe('418 KB')
    expect(fileSize(2621440)).toBe('2.5 MB')
  })

  it('EMPTY_LABEL 為 legacy 用過的空值字樣', () => {
    expect(EMPTY_LABEL).toEqual({
      dash: '—',
      notFilled: '未填寫',
      setDue: '設定期限',
      pickDate: '選擇日期',
      unassigned: '未指派',
    })
  })
})

describe('fmtMoney', () => {
  it('加 $ 與千分位', () => {
    expect(fmtMoney(50000)).toBe('$50,000')
    expect(fmtMoney(0)).toBe('$0')
  })

  it('負數的負號放在 $ 前面', () => {
    expect(fmtMoney(-2500)).toBe('-$2,500')
  })
})

describe('fmtMoneyShort', () => {
  it('未滿 10 億跟 fmtMoney 一樣', () => {
    expect(fmtMoneyShort(50000)).toBe('$50,000')
    expect(fmtMoneyShort(999999999)).toBe('$999,999,999')
  })

  it('10 億以上改縮寫，負數負號在 $ 前', () => {
    expect(fmtMoneyShort(1_000_000_000)).toBe('$1B')
    expect(fmtMoneyShort(123_456_789_012)).toBe('$123.5B')
    expect(fmtMoneyShort(-2_500_000_000_000)).toBe('-$2.5T')
  })
})

describe('fmtWorkdays', () => {
  it('工期一律寫「N 工作天」', () => {
    expect(fmtWorkdays(7)).toBe('7 工作天')
    expect(fmtWorkdays(1)).toBe('1 工作天')
  })
})

describe('fmtYears', () => {
  it('連續年份寫成「A–B」，不連續的用頓號隔開', () => {
    expect(fmtYears([2027])).toBe('2027')
    expect(fmtYears([2027, 2028])).toBe('2027–2028')
    expect(fmtYears([2027, 2029])).toBe('2027、2029')
    expect(fmtYears([2027, 2028, 2029, 2031])).toBe('2027–2029、2031')
    expect(fmtYears([])).toBe('')
  })
})
