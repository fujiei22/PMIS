import { anchorCalendar, anchorOptionMenu, viewport } from '@/lib/anchor'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import { useUiStore, type OptionMenuKind } from '@/stores/ui'
import type { ISODate } from '@/types/models'

export interface Menus {
  /** 開狀態 / 優先度 / 分類 / Issue 欄位的選項選單。 */
  openOptionMenu: (e: MouseEvent, id: string, kind: OptionMenuKind) => void
  /** 開任務的起訖日期選擇器（一定從 start 端開始填）。 */
  openTaskDatePicker: (e: MouseEvent, taskId: string) => void
  /** 開單一日期選擇器；kind='task' 時改的是任務的完成日。 */
  openIssueDatePicker: (
    e: MouseEvent,
    id: string,
    field: 'due' | 'done',
    iso: ISODate | '',
    kind?: 'issue' | 'task',
  ) => void
}

/**
 * 開三種浮層選單，位置由觸發元素的 bounding rect 算（含視窗邊界翻轉）。
 * 定位公式在 lib/anchor.ts；這裡只負責量 rect、湊 store 需要的欄位。
 */
export function useMenus(): Menus {
  const ui = useUiStore()
  const taskStore = useTaskStore()
  const memberStore = useMemberStore()

  /** 各 kind 的選項列數，決定選單估高與往上 / 往下開。legacy `openOpt` 的 N 表 :2673 */
  function rowCountOf(kind: OptionMenuKind): number {
    switch (kind) {
      case 'status':
        return 5
      case 'group':
        return taskStore.groups.length
      case 'ipri':
      case 'iitem':
      case 'istatus':
        return 4
      case 'itask':
        return taskStore.tasks.length
      case 'icreator':
      case 'iowner':
        return memberStore.members.length
      default:
        // priority 與未列出的 kind 沿用 legacy 的預設 3
        return 3
    }
  }

  function rectOf(e: MouseEvent): DOMRect {
    return (e.currentTarget as HTMLElement).getBoundingClientRect()
  }

  function openOptionMenu(e: MouseEvent, id: string, kind: OptionMenuKind): void {
    ui.optionMenu = {
      id,
      kind,
      ...anchorOptionMenu(rectOf(e), rowCountOf(kind), viewport()),
    }
  }

  function openTaskDatePicker(e: MouseEvent, taskId: string): void {
    const t = taskStore.taskById(taskId)
    if (!t) return
    ui.taskDatePicker = {
      id: taskId,
      target: 'start',
      month: t.start.slice(0, 7),
      ...anchorCalendar(rectOf(e), viewport(), 'task'),
    }
  }

  function openIssueDatePicker(
    e: MouseEvent,
    id: string,
    field: 'due' | 'done',
    iso: ISODate | '',
    kind: 'issue' | 'task' = 'issue',
  ): void {
    ui.issueDatePicker = {
      id,
      field,
      kind,
      // 沒填過就從今天所在的月份開始。legacy :2667
      month: (iso || ui.todayIso).slice(0, 7),
      ...anchorCalendar(rectOf(e), viewport(), 'issue'),
    }
  }

  return { openOptionMenu, openTaskDatePicker, openIssueDatePicker }
}
