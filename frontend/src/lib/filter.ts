import { dayIndex } from '@/lib/date'
import { isLate } from '@/lib/schedule'
import type { ISODate, Member, Priority, Task, TaskStatus } from '@/types/models'

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
}

/**
 * 頂欄成員篩選列得出來的人：這個專案有被指派任務的成員（成員篩選比的就是任務負責人），照 `members` 的順序。
 * 已經勾選的人就算後來沒有任務了也留著，才取消得掉。
 */
export function filterableMembers(
  members: readonly Member[],
  tasks: readonly Task[],
  selected: readonly string[],
): Member[] {
  const assigned = new Set(tasks.flatMap((t) => t.assigneeIds))
  return members.filter((m) => assigned.has(m.id) || selected.includes(m.id))
}

/** 成員：沒選就全過，選了取交集。legacy `matchMember` :2027 */
function matchMember(t: Task, f: TaskFilter): boolean {
  if (!f.memberIds.length) return true
  return t.assigneeIds.some((w) => f.memberIds.includes(w))
}

/**
 * 狀態：'delayed' 不是真狀態，要另外用 isLate 判（依基準，t 是推算後的任務，不必再看今天）。
 * legacy `matchStatus` :2230
 */
function matchStatus(t: Task, f: TaskFilter): boolean {
  if (!f.statuses.length) return true
  if (f.statuses.includes(t.status)) return true
  return f.statuses.includes('delayed') && isLate(t)
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
    matchStatus(t, f) &&
    matchPrio(t, f) &&
    matchIssue(t, f, ctx) &&
    matchGroup(t, f)
  )
}

/** 陣列裡有就拿掉、沒有就加上；回新陣列。Dashboard 與總覽的多選篩選、總覽的展開 / 收合清單共用。 */
export function toggleIn<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
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
