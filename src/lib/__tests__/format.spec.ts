import { describe, expect, it } from 'vitest'
import { EMPTY_LABEL, fileSize, fmtDate, shortDate, stripYear, visualLen } from '@/lib/format'

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
