import { isoFromIndex } from '@/lib/date'
import type { ISODate } from '@/types/models'

/**
 * 月曆 42 格的算法（契約 D）。
 * legacy :3457-3461 與改寫後的三個日曆（DatePicker 的兩組 + FilterCalendar）各自寫過一份，
 * 這裡抽成唯一一份；呼叫端只負責「選中 / 區間 / 已排定」這類自己的狀態。
 */

/** 一格日曆；`inMonth` 以外的狀態（選中、區間、已排定）由呼叫端自己疊。 */
export interface CalendarCell {
  iso: ISODate
  /** 日索引（UTC 1970-01-01 起算的天數），呼叫端拿來比大小。 */
  idx: number
  /** 這一格顯示的數字（幾號）。 */
  label: number
  /** 是不是 month 這個月的日子；不是就是前後補的灰字。 */
  inMonth: boolean
  isToday: boolean
}

/** 星期標頭，週日起。legacy :3462 */
export const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * 某個月份的 6 × 7 = 42 格。
 * 起點是該月 1 號往前補到最近的週日；固定 42 格是為了讓月份切換時高度不跳動（legacy :3461）。
 *
 * @param month 'YYYY-MM'（傳 'YYYY-MM-DD' 也可以，只取前 7 碼）
 * @param todayIdx 今天的日索引，用來標 isToday；不在這個月時不會有任何一格為 true
 */
export function monthGrid(month: string, todayIdx: number): CalendarCell[] {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1
  const first = Math.floor(Date.UTC(y, m, 1) / 86_400_000)
  const start = first - new Date(Date.UTC(y, m, 1)).getUTCDay()

  const out: CalendarCell[] = []
  for (let k = 0; k < 42; k++) {
    const idx = start + k
    const dt = new Date(idx * 86_400_000)
    out.push({
      iso: isoFromIndex(idx),
      idx,
      label: dt.getUTCDate(),
      inMonth: dt.getUTCMonth() === m && dt.getUTCFullYear() === y,
      isToday: idx === todayIdx,
    })
  }
  return out
}
