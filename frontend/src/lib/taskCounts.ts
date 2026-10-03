import { isLate, isPlannedDone } from '@/lib/schedule'
import type { Task, TaskStatus } from '@/types/models'

/**
 * 任務計數：Dashboard 摘要卡與專案總覽共用的唯一定義
 * （規則見 docs/reference/scheduling.md〈已延遲與計畫進度〉）。
 */
export interface TaskCounts {
  total: number
  /** 各狀態的任務數；就是總覽 `ProjectSummary.taskCounts` 的內容。 */
  byStatus: Record<TaskStatus, number>
  /** 照計畫此刻該完成（`isPlannedDone`：計畫結束日早於今天）。 */
  planned: number
  /** 已延遲（`isLate`）；跟 byStatus 重疊計數。 */
  late: number
}

/**
 * 哪些任務算數：計數、任務數、看板只看最底層任務（三層任務的上層由下層彙總，不算數）。
 * 目前只有兩層，每個任務都是最底層，回原陣列（不複製）。store 的 `leafTasks` 與總覽的 summarizeProject 都走這裡。
 */
export function leafTasksOf(tasks: Task[]): Task[] {
  return tasks
}

/**
 * 數任務。傳進來的必須是推算後的任務（`scheduleWithPlan` 排過）；只數最底層的由這裡自己挑（`leafTasksOf`），
 * 呼叫端傳全部任務即可，三層任務時也只改 `leafTasksOf` 一處。
 */
export function countTasks(tasks: Task[], todayIdx: number): TaskCounts {
  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, paused: 0, done: 0 }
  let planned = 0
  let late = 0
  const leaves = leafTasksOf(tasks)
  for (const t of leaves) {
    byStatus[t.status]++
    if (isPlannedDone(t, todayIdx)) planned++
    if (isLate(t)) late++
  }
  return { total: leaves.length, byStatus, planned, late }
}
