import { describe, expect, it } from 'vitest'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { createWorkdays, isoWeekday, WEEKEND_ONLY } from '@/lib/workdays'
import type { WorkCalendar } from '@/types/models'

/**
 * 工作日曆的純函式（規則見 docs/reference/scheduling.md〈工作天〉）。
 * 測試日曆 CAL：10/9（五）補假、10/10（六）國慶、10/17（六）補班；
 * 所以 10/9～10/11 連休三天，10/17 雖是週六但要上班。
 */
const CAL: WorkCalendar = {
  weekendDays: [6, 7],
  coveredYears: [2026],
  days: [
    { date: '2026-10-09', isWorkday: false, name: '補假', source: 'official' },
    { date: '2026-10-10', isWorkday: false, name: '國慶日', source: 'official' },
    { date: '2026-10-17', isWorkday: true, name: '補班', source: 'override' },
  ],
}

const d = dayIndex
/** 回傳值換回 ISO 日期再比，失敗訊息才看得懂是哪一天 */
const iso = isoFromIndex

describe('isoWeekday', () => {
  it('日索引換成 ISO 星期（1 = 週一 … 7 = 週日）', () => {
    expect(isoWeekday(d('2026-10-08'))).toBe(4)
    expect(isoWeekday(d('2026-10-10'))).toBe(6)
    expect(isoWeekday(d('2026-10-11'))).toBe(7)
  })
})

describe('createWorkdays', () => {
  const wd = createWorkdays(CAL)

  it('days 有的那天照它，沒有的看週末：補假不上班、週六補班要上班', () => {
    expect(wd.isWorkday(d('2026-10-08'))).toBe(true)
    expect(wd.isWorkday(d('2026-10-09'))).toBe(false)
    expect(wd.isWorkday(d('2026-10-17'))).toBe(true)
    expect(wd.isWorkday(d('2026-10-18'))).toBe(false)
  })

  it('nameOf 回假日名稱，普通日子回空字串', () => {
    expect(wd.nameOf(d('2026-10-10'))).toBe('國慶日')
    expect(wd.nameOf(d('2026-10-12'))).toBe('')
  })

  it('coveredYears 照日曆給的年份', () => {
    expect(wd.coveredYears).toEqual([2026])
  })

  it('onOrAfter 含當天、after 不含當天，都跳過連假', () => {
    expect(iso(wd.onOrAfter(d('2026-10-08')))).toBe('2026-10-08')
    expect(iso(wd.onOrAfter(d('2026-10-09')))).toBe('2026-10-12')
    expect(iso(wd.after(d('2026-10-08')))).toBe('2026-10-12')
    // 10/17 是週六補班，下一個工作天就是它
    expect(iso(wd.after(d('2026-10-16')))).toBe('2026-10-17')
  })

  it('addWorkdays 起訖都算：spec 的例子', () => {
    // 工期 3、從 10/08 開始：10/08、10/12、10/13
    expect(iso(wd.addWorkdays(d('2026-10-08'), 3))).toBe('2026-10-13')
    // 工期 1：當天就結束
    expect(iso(wd.addWorkdays(d('2026-10-08'), 1))).toBe('2026-10-08')
    // 開始日本身放假：從下一個工作天算第 1 天
    expect(iso(wd.addWorkdays(d('2026-10-10'), 1))).toBe('2026-10-12')
  })

  it('countWorkdays 含頭尾、算到補班，倒過來回 0', () => {
    expect(wd.countWorkdays(d('2026-10-08'), d('2026-10-13'))).toBe(3)
    // 10/12～10/16 五天加 10/17 補班
    expect(wd.countWorkdays(d('2026-10-12'), d('2026-10-18'))).toBe(6)
    expect(wd.countWorkdays(d('2026-10-13'), d('2026-10-08'))).toBe(0)
  })

  it('日曆全部是週末時 onOrAfter 回原日，不會卡死', () => {
    // 資料有誤的防護：掃描有上限，找不到工作天就回原日
    const allOff = createWorkdays({
      weekendDays: [1, 2, 3, 4, 5, 6, 7],
      coveredYears: [],
      days: [],
    })
    expect(iso(allOff.onOrAfter(d('2026-10-08')))).toBe('2026-10-08')
  })
})

describe('WEEKEND_ONLY', () => {
  it('日曆沒載入時只看週六日：補假那天照常上班', () => {
    expect(WEEKEND_ONLY.isWorkday(d('2026-10-09'))).toBe(true)
    expect(WEEKEND_ONLY.isWorkday(d('2026-10-10'))).toBe(false)
    expect(WEEKEND_ONLY.coveredYears).toEqual([])
  })
})
