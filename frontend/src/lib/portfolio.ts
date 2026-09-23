import {
  DUE_SOON_DAYS,
  LATE_DELAYED_TASKS,
  LATE_GAP,
  WATCH_GAP,
} from '@/constants/overview'
import { dayIndex, shiftMonth } from '@/lib/date'
import type { SortKey } from '@/lib/sort'
import type { ISODate, Member, ProjectAlert, ProjectStatus, ProjectSummary } from '@/types/models'

/**
 * 多專案總覽的純函式：專案派生值、篩選、多鍵排序、PM 分組、PM 選項計數、時間軸範圍。
 * 不碰 store 與 DOM；「今天」一律由呼叫端傳入，測試才能固定日期。
 */

/** 總覽的排序鍵：落後百分點 / 開始日 / 到期日 / 未結 Issue 數。 */
export type OverviewSortKey = 'gap' | 'start' | 'due' | 'issues'

/** 狀態徽章：有需注意程度時優先顯示它，否則顯示專案狀態。 */
export type ProjectBadgeKind = 'late' | 'watch' | 'doing' | 'todo' | 'done'

/** 由 ProjectSummary 與今天日期算出的畫面用數值。 */
export interface ProjectDerived {
  /** 實際完成百分比（已完成 / 總數） */
  actualPct: number
  /** 理論完成百分比（排程應完成 / 總數） */
  plannedPct: number
  /** 落後百分點，實際超前時為 0 */
  gap: number
  /** 需注意程度 */
  alert: ProjectAlert
  /** 狀態徽章 */
  badge: ProjectBadgeKind
  /** 四個等級的未結 Issue 加總 */
  openIssueTotal: number
  /** 開始日到到期日的天數，頭尾兩天都算（同 Dashboard「專案總時長」） */
  totalDays: number
  /** 已過天數（夾在 0 ~ totalDays） */
  elapsedDays: number
  /** 剩餘天數 */
  remainingDays: number
  /** 時間進度百分比 */
  timePct: number
}

/** 一列專案：原始摘要＋派生值，總覽各處都傳這個。 */
export interface ProjectRow {
  p: ProjectSummary
  d: ProjectDerived
}

/** 總覽的篩選條件；每組空陣列代表不篩。 */
export interface OverviewFilter {
  pmIds: string[]
  statuses: ProjectStatus[]
  alerts: ProjectAlert[]
}

/** 一位 PM 底下的專案列；alertCount 是落後＋需注意的專案數。 */
export interface PmGroup {
  pm: Member
  rows: ProjectRow[]
  alertCount: number
}

/** 成員篩選下拉的一個選項與它的計數。 */
export interface PmOption {
  pm: Member
  doing: number
  todo: number
  hasAlert: boolean
  total: number
}

/** 時間軸的一個月；iso 為 'YYYY-MM'。 */
export interface TimelineMonth {
  iso: string
  days: number
}

/** 時間軸的一天；idx 是絕對日索引（lib/date.ts 的 dayIndex），可直接和 clock.todayIdx 比。 */
export interface TimelineDay {
  idx: number
  /** 當月第幾日（1 起） */
  date: number
  /** 0 = 週日 … 6 = 週六 */
  weekday: number
  isWeekend: boolean
  isMonday: boolean
}

/** 時間軸的整體範圍：從 startIdx（某月 1 日）起共 days 天。 */
export interface TimelineRange {
  startIdx: number
  days: number
  months: TimelineMonth[]
  dayList: TimelineDay[]
}

/** 落後程度的色調：behind 紅、warn 黃、flat 不上色。 */
export type GapTone = 'behind' | 'warn' | 'flat'

/** 總覽的預設排序：落後多的在前，同落後值再依到期日由近到遠。 */
export const DEFAULT_OVERVIEW_SORT: SortKey[] = [
  { k: 'gap', dir: 'desc' },
  { k: 'due', dir: 'asc' },
]

/** 百分比四捨五入到整數；總數為 0 時回 0，避免除以零。 */
export function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

/**
 * 判斷專案的需注意程度。只有進行中的專案會被標記。
 * 落後 ≥ LATE_GAP 或延遲任務 ≥ LATE_DELAYED_TASKS → late；
 * 有 A 級未結 Issue 或落後 ≥ WATCH_GAP → watch；其餘 none。
 */
export function alertOf(p: ProjectSummary, gap: number): ProjectAlert {
  if (p.status !== 'doing') return 'none'
  if (gap >= LATE_GAP || p.delayedTasks >= LATE_DELAYED_TASKS) return 'late'
  if (p.openIssues.A > 0 || gap >= WATCH_GAP) return 'watch'
  return 'none'
}

/** 由專案摘要與今天日期算出畫面用的派生值（百分比、落後、天數、徽章）。 */
export function deriveProject(p: ProjectSummary, todayIso: ISODate): ProjectDerived {
  const actualPct = pct(p.taskDone, p.taskTotal)
  const plannedPct = pct(p.taskPlanned, p.taskTotal)
  const gap = Math.max(0, plannedPct - actualPct)
  const alert = alertOf(p, gap)
  // 頭尾都算，和 Dashboard「專案總時長」（max − min + 1）一致；到期日當天還剩 1 天（review 後 user 決定）
  const totalDays = dayIndex(p.dueDate) - dayIndex(p.startDate) + 1
  // 已完成的專案一律視為時間走完，不看今天落在哪
  const elapsedDays =
    p.status === 'done'
      ? totalDays
      : Math.min(totalDays, Math.max(0, dayIndex(todayIso) - dayIndex(p.startDate)))
  const { A, B, C, D } = p.openIssues
  return {
    actualPct,
    plannedPct,
    gap,
    alert,
    badge: alert !== 'none' ? alert : p.status,
    openIssueTotal: A + B + C + D,
    totalDays,
    elapsedDays,
    remainingDays: totalDays - elapsedDays,
    timePct: pct(elapsedDays, totalDays),
  }
}

/** 篩選：三組條件之間是 AND、組內是 OR；空陣列代表該組不篩。 */
export function matchProject(row: ProjectRow, f: OverviewFilter): boolean {
  if (f.pmIds.length && !f.pmIds.includes(row.p.pmId)) return false
  if (f.statuses.length && !f.statuses.includes(row.p.status)) return false
  if (f.alerts.length && !f.alerts.includes(row.d.alert)) return false
  return true
}

/** 取某排序鍵在一列上的比較值；未知鍵回 0（不影響順序）。 */
function sortValueOf(row: ProjectRow, k: string): number {
  if (k === 'gap') return row.d.gap
  if (k === 'start') return dayIndex(row.p.startDate)
  if (k === 'due') return dayIndex(row.p.dueDate)
  if (k === 'issues') return row.d.openIssueTotal
  return 0
}

/**
 * 多鍵排序，回傳新陣列、不改動輸入。
 * 依序比到分出高下為止；全部相等時靠 Array.prototype.sort 的穩定性保住原順序。
 */
export function sortRows(rows: ProjectRow[], sorts: SortKey[]): ProjectRow[] {
  return rows.slice().sort((a, b) => {
    for (const s of sorts) {
      const c = sortValueOf(a, s.k) - sortValueOf(b, s.k)
      if (c) return s.dir === 'desc' ? -c : c
    }
    return 0
  })
}

/** 落後百分點對應的色調，門檻與 alertOf 共用。 */
export function gapTone(gap: number): GapTone {
  if (gap >= LATE_GAP) return 'behind'
  if (gap >= WATCH_GAP) return 'warn'
  return 'flat'
}

/** 到期日距今 ≤ DUE_SOON_DAYS 天就算快到期；已逾期時差值為負，也回 true。 */
export function dueSoon(due: ISODate, todayIso: ISODate): boolean {
  return dayIndex(due) - dayIndex(todayIso) <= DUE_SOON_DAYS
}

/**
 * 依 PM 分組。組的順序＝各 PM 第一個專案在（已排序）清單中的位置，組內保留原順序。
 * 查不到 PM 的專案不進任何組，id 放進 orphans（store 會 console.warn，counts 以 groups 為準）。
 */
export function groupByPm(
  rows: ProjectRow[],
  memberById: (id: string) => Member | undefined,
): { groups: PmGroup[]; orphans: string[] } {
  const byPm = new Map<string, PmGroup>()
  const orphans: string[] = []
  for (const row of rows) {
    let g = byPm.get(row.p.pmId)
    if (!g) {
      const pm = memberById(row.p.pmId)
      if (!pm) {
        orphans.push(row.p.id)
        continue
      }
      g = { pm, rows: [], alertCount: 0 }
      byPm.set(row.p.pmId, g)
    }
    g.rows.push(row)
    if (row.d.alert !== 'none') g.alertCount++
  }
  return { groups: [...byPm.values()], orphans }
}

/** 成員篩選的選項：依傳入的 pms 順序，算每位 PM 的進行中 / 未開始 / 全部專案數與是否有需注意專案。 */
export function pmOptions(rows: ProjectRow[], pms: Member[]): PmOption[] {
  return pms.map((pm) => {
    const own = rows.filter((r) => r.p.pmId === pm.id)
    return {
      pm,
      doing: own.filter((r) => r.p.status === 'doing').length,
      todo: own.filter((r) => r.p.status === 'todo').length,
      hasAlert: own.some((r) => r.d.alert !== 'none'),
      total: own.length,
    }
  })
}

/** 某年某月（month 為 1–12）的天數；Date.UTC 的第 0 日就是上個月最後一天。 */
function daysInMonth(y: number, month: number): number {
  return new Date(Date.UTC(y, month, 0)).getUTCDate()
}

/**
 * 時間軸範圍：從最早日期所在月的 1 日，到最晚日期所在月的最後一天。
 * 範圍涵蓋所有專案與今天所在的月份。
 */
export function timelineRange(projects: ProjectSummary[], todayIso: ISODate): TimelineRange {
  // ISO 日期字串可直接字典序比大小
  const isos = [todayIso, ...projects.flatMap((p) => [p.startDate, p.dueDate])].sort()
  const firstMonth = isos[0]!.slice(0, 7)
  const lastMonth = isos[isos.length - 1]!.slice(0, 7)

  const months: TimelineMonth[] = []
  const dayList: TimelineDay[] = []
  const startIdx = dayIndex(firstMonth + '-01')
  for (let iso = firstMonth; iso <= lastMonth; iso = shiftMonth(iso, 1)) {
    const y = Number(iso.slice(0, 4))
    const month = Number(iso.slice(5, 7))
    const days = daysInMonth(y, month)
    months.push({ iso, days })
    for (let date = 1; date <= days; date++) {
      const weekday = new Date(Date.UTC(y, month - 1, date)).getUTCDay()
      dayList.push({
        idx: startIdx + dayList.length,
        date,
        weekday,
        isWeekend: weekday === 0 || weekday === 6,
        isMonday: weekday === 1,
      })
    }
  }
  return { startIdx, days: dayList.length, months, dayList }
}
