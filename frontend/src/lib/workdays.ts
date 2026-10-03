import { dayIndex, isoFromIndex } from '@/lib/date'
import type { WorkCalendar } from '@/types/models'

/**
 * 工作日曆：哪天上班、往後找工作天、加減與計數工作天。規則見 docs/reference/scheduling.md〈工作天〉。
 * 全部以日索引運算（lib/date.ts 的 dayIndex）；days 有的那天照它，沒有的看 ISO 星期是否是週末。
 */

/** 往後找工作天最多掃幾天：連假再長也遠小於一年；超過表示日曆資料有誤，回原日，不讓迴圈卡死。 */
const SCAN_LIMIT = 366

export interface Workdays {
  /** 那天要不要上班 */
  isWorkday(idx: number): boolean
  /** 當天或之後的第一個工作天 */
  onOrAfter(idx: number): number
  /** 之後（不含當天）的第一個工作天 */
  after(idx: number): number
  /** 從 onOrAfter(start) 起算的第 n 個工作天（n 小於 1 當 1） */
  addWorkdays(startIdx: number, n: number): number
  /** [a, b] 之間的工作天數（含頭尾）；b 早於 a 回 0 */
  countWorkdays(a: number, b: number): number
  /** 假日或補班的名稱；普通日子回 '' */
  nameOf(idx: number): string
  /** 官方資料完整匯入的年份 */
  coveredYears: readonly number[]
}

/** 日索引 → ISO 星期（1 = 週一 … 7 = 週日）。日索引 0（1970-01-01）是週四。 */
export function isoWeekday(idx: number): number {
  return ((((idx + 3) % 7) + 7) % 7) + 1
}

/** 由 `GET /api/calendar` 的回應建出查詢；null（還沒載入或載入失敗）時只看週六日。 */
export function createWorkdays(cal: WorkCalendar | null): Workdays {
  const weekend = new Set(cal?.weekendDays ?? [6, 7])
  const special = new Map<number, { isWorkday: boolean; name: string }>()
  for (const day of cal?.days ?? [])
    special.set(dayIndex(day.date), { isWorkday: day.isWorkday, name: day.name })

  const isWorkday = (idx: number): boolean =>
    special.get(idx)?.isWorkday ?? !weekend.has(isoWeekday(idx))

  function onOrAfter(idx: number): number {
    for (let k = 0; k < SCAN_LIMIT; k++) if (isWorkday(idx + k)) return idx + k
    return idx
  }

  const after = (idx: number): number => onOrAfter(idx + 1)

  function addWorkdays(startIdx: number, n: number): number {
    let day = onOrAfter(startIdx)
    for (let k = 1; k < Math.max(1, n); k++) day = after(day)
    return day
  }

  function countWorkdays(a: number, b: number): number {
    let n = 0
    for (let idx = a; idx <= b; idx++) if (isWorkday(idx)) n++
    return n
  }

  return {
    isWorkday,
    onOrAfter,
    after,
    addWorkdays,
    countWorkdays,
    nameOf: (idx) => special.get(idx)?.name ?? '',
    coveredYears: cal?.coveredYears ?? [],
  }
}

/** 只看週六日的日曆：日曆還沒載入或載入失敗時用。 */
export const WEEKEND_ONLY: Workdays = createWorkdays(null)

/**
 * 某個月（'YYYY-MM'）有名稱的非工作天，依日期排成「M/D 名稱」（日期選擇器底部的本月假日）。
 * 補班日是工作天、沒有名稱的普通週末都不列。
 */
export function monthHolidayList(month: string, wd: Workdays): string[] {
  const out: string[] = []
  for (let idx = dayIndex(`${month}-01`); isoFromIndex(idx).startsWith(month); idx++) {
    const name = wd.nameOf(idx)
    if (name && !wd.isWorkday(idx)) {
      const iso = isoFromIndex(idx)
      out.push(`${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${name}`)
    }
  }
  return out
}
