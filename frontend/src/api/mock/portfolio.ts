import { dayIndex } from '@/lib/date'
import { scheduleWithPlan } from '@/lib/schedule'
import { countTasks } from '@/lib/taskCounts'
import { createWorkdays, type Workdays } from '@/lib/workdays'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import {
  PMIS_META,
  PORTFOLIO_CURRENT_USER,
  PORTFOLIO_MEMBERS,
  STATIC_PROJECTS,
} from '@/mocks/samplePortfolio'
import type {
  ISODate,
  IssueLevel,
  PortfolioData,
  ProjectData,
  ProjectStatus,
  ProjectSummary,
  TaskStatus,
  WorkCalendar,
} from '@/types/models'

/** 近期到期任務最多列幾筆。 */
const UPCOMING_LIMIT = 3

/**
 * 專案整體狀態，依任務狀態的數量算（不存欄位，後端同一套規則）：
 * - 有任務且全部完成 → 'done'
 * - 有任何進行中或已完成 → 'doing'
 * - 其他（沒有任務、全部未開始、只有暫停或暫停加未開始）→ 'todo'
 */
export function projectStatusOf(counts: Record<TaskStatus, number>): ProjectStatus {
  const total = counts.done + counts.doing + counts.paused + counts.todo
  if (total > 0 && counts.done === total) return 'done'
  if (counts.doing > 0 || counts.done > 0) return 'doing'
  return 'todo'
}

/**
 * 把一份完整專案資料彙整成總覽用的摘要。mock 在這裡扮演後端的彙整邏輯，
 * 規則同 `api/types.ts` 檔頭的 wire 約定：
 *
 * - 先用今天把任務排一次、填上計畫（`scheduleWithPlan`，規則見 docs/reference/scheduling.md），
 *   下面的日期與延遲都看推算結果，跟 Dashboard 畫面上看到的一致；存的起訖可能是幾天前寫回的快照。
 * - status：`projectStatusOf(taskCounts)`。
 * - 起訖日：任務 start 的最小值 / end 的最大值；沒有任務時兩者都是今天。
 * - taskPlanned：`countTasks` 的 planned（`isPlannedDone`），與 Dashboard 摘要卡同一份。
 * - delayedTasks：`countTasks` 的 late（`isLate`），與 Dashboard 摘要卡同一份；和 taskCounts 重疊計數。
 * - openIssues：未結 Issue 依等級計數；memberIds：至少被指派一個任務的成員，順序照 data.members。
 * - upcoming：未完成任務依 end 升冪取前 3，**含已逾期**（逾期的最該被看到）。
 * - 近期任務（upcoming）、成員（memberIds）目前看全部任務；三層任務時再決定要不要只看最底層。
 * - 不變式：taskDone === taskCounts.done、taskTotal === 各狀態加總。
 */
export function summarizeProject(
  data: ProjectData,
  meta: { id: string; name: string; pmId: string },
  todayIso: ISODate,
  workdays: Workdays,
): ProjectSummary {
  const todayIdx = dayIndex(todayIso)
  const tasks = scheduleWithPlan(data.tasks, data.deps, workdays, todayIdx)
  // 計數跟 Dashboard 摘要卡同一個定義（lib/taskCounts.ts）：只數最底層任務
  const counts = countTasks(tasks, todayIdx)
  const taskCounts: Record<TaskStatus, number> = { ...counts.byStatus }

  const openIssues: Record<IssueLevel, number> = { A: 0, B: 0, C: 0, D: 0 }
  let closedIssues = 0
  for (const i of data.issues) {
    if (i.status === 'closed') closedIssues++
    else openIssues[i.level]++
  }

  const assigned = new Set(tasks.flatMap((t) => t.assigneeIds))
  // ISODate 允許 ''（沒填日期）。空字串會排在最前面、dayIndex('') 是 NaN，
  // 所以起訖日、應完成數、近期任務只看有填日期的任務
  // ISODate 字串可以直接比大小，不必轉日索引
  const starts = tasks
    .map((t) => t.start)
    .filter(Boolean)
    .sort()
  const ends = tasks
    .map((t) => t.end)
    .filter(Boolean)
    .sort()

  return {
    ...meta,
    status: projectStatusOf(taskCounts),
    startDate: starts[0] ?? todayIso,
    dueDate: ends[ends.length - 1] ?? todayIso,
    taskTotal: counts.total,
    taskDone: counts.byStatus.done,
    taskPlanned: counts.planned,
    taskCounts,
    delayedTasks: counts.late,
    openIssues,
    closedIssues,
    memberIds: data.members.filter((m) => assigned.has(m.id)).map((m) => m.id),
    upcoming: tasks
      .filter((t) => t.status !== 'done' && t.end)
      .sort((a, b) => dayIndex(a.end) - dayIndex(b.end))
      .slice(0, UPCOMING_LIMIT)
      .map((t) => ({ name: t.name, due: t.end, memberId: t.assigneeIds[0] ?? '' })),
  }
}

/**
 * 組出 `listProjects()` 的回傳：PMIS 由 `data` 即時彙整，其餘是靜態摘要。
 * 全部是複本，呼叫端改了也不會影響下一次。
 *
 * @param calendar 排程用的工作日曆；mock api 傳它目前的日曆（`setCalendar` 可換），測試省略時用範例日曆
 */
export function buildPortfolio(
  data: ProjectData,
  todayIso: ISODate,
  calendar: WorkCalendar = sampleCalendar,
): PortfolioData {
  const workdays = createWorkdays(calendar)
  return {
    projects: [
      summarizeProject(data, PMIS_META, todayIso, workdays),
      ...structuredClone(STATIC_PROJECTS),
    ],
    members: structuredClone(PORTFOLIO_MEMBERS),
    currentUserId: PORTFOLIO_CURRENT_USER,
  }
}
