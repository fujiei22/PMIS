import { isoFromIndex } from '@/lib/date'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import type { Issue, Task } from '@/types/models'

/** 新任務預設的工期（今天起算共 5 天）。legacy `addTask` :4128 */
const DEFAULT_SPAN = 4

export interface TaskActions {
  /** ＋任務：算好預設值建立並選取；一個分類都沒有時改成新增分類並回 null。 */
  addTaskWithDefaults: () => Task | null
  /** ＋開立 Issue：算好建立者後建立；任務不存在回 null。 */
  addIssueForTask: (taskId: string) => Issue | null
}

/**
 * 「新增」的預設值（契約 E）。
 *
 * 這些值要讀 selection / filter / clock——都是派生層，資料 store 不該認識它們，
 * 所以預設值在這裡算好再傳給 `taskStore.addTask` / `issueStore.addIssue`，
 * 建立後的選取也在這裡做。呼叫端（GanttPanel / KanbanPanel / IssuePanel /
 * TaskProperties）一律用這兩支，不要自己拼預設值。
 */
export function useTaskActions(): TaskActions {
  function addTaskWithDefaults(): Task | null {
    const taskStore = useTaskStore()
    // legacy：一個分類都沒有時這顆按鈕改成「新增分類」（:4128）
    if (!taskStore.groups.length) {
      taskStore.addGroup()
      return null
    }
    const selection = useSelectionStore()
    const base = useClockStore().todayIdx
    const groupId =
      selection.groupId ??
      (selection.taskId ? taskStore.taskById(selection.taskId)?.groupId : null) ??
      taskStore.groups[0]!.id

    const task = taskStore.addTask({
      groupId,
      assigneeIds: useFilterStore().memberIds.slice(),
      start: isoFromIndex(base),
      end: isoFromIndex(base + DEFAULT_SPAN),
    })
    if (task) selection.selectTask(task.id)
    return task
  }

  function addIssueForTask(taskId: string): Issue | null {
    const task = useTaskStore().taskById(taskId)
    if (!task) return null
    // 建立者取任務第一位負責人，沒有負責人就掛在目前登入者身上。legacy `onAddIssue` :3109
    const creatorId = task.assigneeIds[0] ?? useMemberStore().currentUserId
    return useIssueStore().addIssue(task, creatorId)
  }

  return { addTaskWithDefaults, addIssueForTask }
}
