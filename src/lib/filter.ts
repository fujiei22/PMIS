import { dayIndex } from '@/lib/date'
import { isLate } from '@/lib/schedule'
import type { ISODate, Priority, Task, TaskStatus } from '@/types/models'

/** 頂部篩選列的完整條件；各欄的初始值見 filterStore（契約 D）。 */
export interface TaskFilter {
  memberIds: string[]
  statuses: (TaskStatus | 'delayed')[]
  priorities: Priority[]
  groupIds: string[]
  issueMode: 'all' | 'has' | 'none'
  dateMode: 'off' | 'gt' | 'lt' | 'between'
  d1: ISODate | ''
  d2: ISODate | ''
}

/** matchTask 需要但算不出來的外部資訊。 */
export interface MatchCtx {
  /** 該任務未結案的 Issue 數 */
  openIssueCount: (taskId: string) => number
  todayIdx: number
}

/** 成員：沒選就全過，選了取交集。legacy `matchMember` :2027 */
function matchMember(t: Task, f: TaskFilter): boolean {
  if (!f.memberIds.length) return true
  return t.assigneeIds.some((w) => f.memberIds.includes(w))
}

/** 狀態：'delayed' 不是真狀態，要另外用 isLate 判。legacy `matchStatus` :2230 */
function matchStatus(t: Task, f: TaskFilter, ctx: MatchCtx): boolean {
  if (!f.statuses.length) return true
  if (f.statuses.includes(t.status)) return true
  return f.statuses.includes('delayed') && isLate(t, ctx.todayIdx)
}

/** 優先度。legacy `matchPrio` :2235 */
function matchPrio(t: Task, f: TaskFilter): boolean {
  return !f.priorities.length || f.priorities.includes(t.priority)
}

/** 有無未結 Issue。legacy `matchIssue` :2240 */
function matchIssue(t: Task, f: TaskFilter, ctx: MatchCtx): boolean {
  if (f.issueMode === 'all') return true
  const n = ctx.openIssueCount(t.id)
  return f.issueMode === 'has' ? n > 0 : n === 0
}

/** 分類。legacy `matchGroup` :2044 */
function matchGroup(t: Task, f: TaskFilter): boolean {
  return !f.groupIds.length || f.groupIds.includes(t.groupId)
}

/**
 * 日期三模式。legacy `matchDate` :2247。
 * gt 比 end、lt 比 start、between 看區間有沒有重疊（d1 / d2 順序可顛倒）。
 */
function matchDate(t: Task, f: TaskFilter): boolean {
  if (f.dateMode === 'off') return true
  if (f.dateMode === 'gt') return !f.d1 || dayIndex(t.end) >= dayIndex(f.d1)
  if (f.dateMode === 'lt') return !f.d1 || dayIndex(t.start) <= dayIndex(f.d1)
  if (f.dateMode === 'between') {
    if (!f.d1 || !f.d2) return true
    const x = dayIndex(f.d1)
    const y = dayIndex(f.d2)
    return dayIndex(t.start) <= Math.max(x, y) && dayIndex(t.end) >= Math.min(x, y)
  }
  return true
}

/** 任務是否通過全部篩選條件。legacy `matchTask` :2033 */
export function matchTask(t: Task, f: TaskFilter, ctx: MatchCtx): boolean {
  return (
    matchDate(t, f) &&
    matchMember(t, f) &&
    matchStatus(t, f, ctx) &&
    matchPrio(t, f) &&
    matchIssue(t, f, ctx) &&
    matchGroup(t, f)
  )
}

/** 任務篩選是否有任何一欄被動過。legacy `softFilter` 的條件式 :2703 */
export function anyTaskFilter(f: TaskFilter): boolean {
  return (
    f.dateMode !== 'off' ||
    f.memberIds.length > 0 ||
    f.statuses.length > 0 ||
    f.priorities.length > 0 ||
    f.groupIds.length > 0 ||
    f.issueMode !== 'all'
  )
}
