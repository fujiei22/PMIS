import { dayIndex } from '@/lib/date'
import { isLate } from '@/lib/schedule'
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
} from '@/types/models'

/** 近期到期任務最多列幾筆。 */
const UPCOMING_LIMIT = 3

/**
 * 把一份完整專案資料彙整成總覽用的摘要。mock 在這裡扮演後端的彙整邏輯，
 * 規則同 `api/types.ts` 檔頭的 wire 約定：
 *
 * - 起訖日：任務 start 的最小值 / end 的最大值；沒有任務時兩者都是今天。
 * - taskPlanned：`end` 在今天之前的任務數（照排程今天之前就該完成）。
 * - delayedTasks：`isLate` 為真的任務數，與 Dashboard「已延遲」同一個定義；和 taskCounts 重疊計數。
 * - openIssues：未結 Issue 依等級計數；memberIds：至少被指派一個任務的成員，順序照 data.members。
 * - upcoming：未完成任務依 end 升冪取前 3，**含已逾期**（逾期的最該被看到）。
 * - 不變式：taskDone === taskCounts.done、taskTotal === 各狀態加總。
 */
export function summarizeProject(
  data: ProjectData,
  meta: { id: string; name: string; pmId: string; status: ProjectStatus },
  todayIso: ISODate,
): ProjectSummary {
  const todayIdx = dayIndex(todayIso)
  const tasks = data.tasks

  const taskCounts: Record<TaskStatus, number> = { done: 0, doing: 0, paused: 0, todo: 0 }
  for (const t of tasks) taskCounts[t.status]++

  const openIssues: Record<IssueLevel, number> = { A: 0, B: 0, C: 0, D: 0 }
  let closedIssues = 0
  for (const i of data.issues) {
    if (i.status === 'closed') closedIssues++
    else openIssues[i.level]++
  }

  const assigned = new Set(tasks.flatMap((t) => t.assigneeIds))
  // ISODate 字串可以直接比大小，不必轉日索引
  const starts = tasks.map((t) => t.start).sort()
  const ends = tasks.map((t) => t.end).sort()

  return {
    ...meta,
    startDate: starts[0] ?? todayIso,
    dueDate: ends[ends.length - 1] ?? todayIso,
    taskTotal: tasks.length,
    taskDone: taskCounts.done,
    taskPlanned: tasks.filter((t) => dayIndex(t.end) < todayIdx).length,
    taskCounts,
    delayedTasks: tasks.filter((t) => isLate(t, todayIdx)).length,
    openIssues,
    closedIssues,
    memberIds: data.members.filter((m) => assigned.has(m.id)).map((m) => m.id),
    upcoming: tasks
      .filter((t) => t.status !== 'done')
      .sort((a, b) => dayIndex(a.end) - dayIndex(b.end))
      .slice(0, UPCOMING_LIMIT)
      .map((t) => ({ name: t.name, due: t.end, memberId: t.assigneeIds[0] ?? '' })),
  }
}

/**
 * 組出 `listProjects()` 的回傳：PMIS 由 `data` 即時彙整，其餘是靜態摘要。
 * 全部是複本，呼叫端改了也不會影響下一次。
 */
export function buildPortfolio(data: ProjectData, todayIso: ISODate): PortfolioData {
  return {
    projects: [summarizeProject(data, PMIS_META, todayIso), ...structuredClone(STATIC_PROJECTS)],
    members: structuredClone(PORTFOLIO_MEMBERS),
    currentUserId: PORTFOLIO_CURRENT_USER,
  }
}
