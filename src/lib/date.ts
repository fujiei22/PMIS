import type { ISODate, Task } from '@/types/models'

/**
 * 日期都先換算成「日索引」（UTC 1970-01-01 起算的天數）再運算。
 * 全部函式都對照 legacy/Dashboard.html 的同名方法，行號標在各函式上。
 */

/** 'YYYY-MM-DD' → 日索引。legacy `di` :1891 */
export function dayIndex(iso: ISODate): number {
  return Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000)
}

/** 日索引 → 'YYYY-MM-DD'。legacy `ds` :1897 */
export function isoFromIndex(i: number): ISODate {
  return new Date(i * 86400000).toISOString().slice(0, 10)
}

/**
 * 毫秒時間戳 → 今天的日索引。legacy `todayIdx` :2276。
 * now 由 uiStore 提供而不是直接讀 Date.now()，測試與 e2e 才能固定時鐘。
 */
export function todayIndex(now: number): number {
  return Math.floor(now / 86400000)
}

/** 任務工期（天），含頭尾兩天。legacy `len` :1900 */
export function lengthOf(t: Pick<Task, 'start' | 'end'>): number {
  return dayIndex(t.end) - dayIndex(t.start) + 1
}

/**
 * 把 'YYYY-MM'（或 'YYYY-MM-DD'）的月份加減 n 個月，回 'YYYY-MM'。legacy `shiftMonth` :2016。
 * 交給 Date.UTC 處理進位，跨年不用自己算。
 */
export function shiftMonth(anchorYYYYMM: string, n: number): string {
  const y = Number(anchorYYYYMM.slice(0, 4))
  const m = Number(anchorYYYYMM.slice(5, 7)) - 1 + n
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}

/**
 * 今天的工作時間過了幾成（0-1），今日線的水位。legacy `dayFraction` :1986。
 * 用本地時間（使用者看到的時鐘），不是 UTC。
 */
export function dayFraction(now: Date, workStart = 8.5, workEnd = 18.5): number {
  if (workEnd <= workStart) return 0
  const h = now.getHours() + now.getMinutes() / 60
  return Math.max(0, Math.min(1, (h - workStart) / (workEnd - workStart)))
}
