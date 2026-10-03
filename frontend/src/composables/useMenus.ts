import { EDIT_NOTE_TEXT, MONTH_HOLIDAYS_TEXT, PICK_LIMIT_TEXT } from '@/constants/dashboard'
import {
  anchorCalendar,
  anchorOptionMenu,
  anchorRowMenu,
  calendarExtra,
  rowMenuExtra,
  viewport,
} from '@/lib/anchor'
import { durationNote, taskPickerNote } from '@/lib/editPolicy'
import { monthHolidayList } from '@/lib/workdays'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useTaskStore } from '@/stores/task'
import { useUiStore, type OptionMenuKind } from '@/stores/ui'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { ISODate } from '@/types/models'

export type MenuAnchorKind = 'option' | 'row' | 'taskDate' | 'issueDate'

/**
 * fixed 浮層各自的觸發元素，給 useCloseOnScroll 判斷捲動有沒有把它帶走。
 * DOM 元素不放進 store（不可序列化，也不需要響應式）；一種浮層只留最後一次開它的元素。
 */
export const menuAnchors: Record<MenuAnchorKind, HTMLElement | null> = {
  option: null,
  row: null,
  taskDate: null,
  issueDate: null,
}

/** 放掉所有記下的觸發元素：離開 Dashboard 時呼叫（DashboardView），模組層不再抓著已脫離的 DOM。 */
export function clearMenuAnchors(): void {
  for (const k of Object.keys(menuAnchors) as MenuAnchorKind[]) menuAnchors[k] = null
}

/**
 * 四支都會自己 `stopPropagation()`（觸發元素不必寫 `@click.stop`）：可編輯時點擊不往上傳，
 * 不會順便選取所在的列 / 卡片；唯讀時不開、也不攔，點擊照常落到列 / 卡片去選取。
 */
export interface Menus {
  /** 開狀態 / 優先度 / 分類 / Issue 欄位的選項選單。 */
  openOptionMenu: (e: MouseEvent, id: string, kind: OptionMenuKind) => void
  /** 開任務的起訖日期選擇器：從開始日填起；開始日不能改（有前置、未開始）時對準結束日。 */
  openTaskDatePicker: (e: MouseEvent, taskId: string) => void
  /** 開甘特任務列「⋮」的動作選單；再點同一列的「⋮」就關掉。 */
  toggleRowMenu: (e: MouseEvent, taskId: string) => void
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
 *
 * 這四種浮層都是改資料用的：唯讀時（`ui.canEdit` 是 false）一律不開、也不攔下點擊（F2），
 * 元件不必各自判斷，觸發元素的游標與 hover 樣式由元件依 `ui.canEdit` 拿掉。
 */
export function useMenus(): Menus {
  const clock = useClockStore()
  const ui = useUiStore()
  const taskStore = useTaskStore()
  const memberStore = useMemberStore()
  const issueStore = useIssueStore()

  /** 各 kind 的選項列數，決定選單估高與往上 / 往下開。legacy `openOpt` 的 N 表 :2673 */
  function rowCountOf(kind: OptionMenuKind, id: string): number {
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
      case 'iowner': {
        // 跟 OptionMenu 列的是同一份：沒停用的人，加上原本就選了的停用者
        const issue = issueStore.byId(id)
        const keep = !issue ? [] : kind === 'icreator' ? [issue.creatorId] : issue.ownerIds
        return memberStore.assignable(keep).length
      }
      default:
        // priority 與未列出的 kind 沿用 legacy 的預設 3
        return 3
    }
  }

  /** 量觸發元素的 rect，並記下觸發元素（menuAnchors）。 */
  function rectOf(e: MouseEvent, kind: MenuAnchorKind): DOMRect {
    const el = e.currentTarget as HTMLElement
    menuAnchors[kind] = el
    return el.getBoundingClientRect()
  }

  function openOptionMenu(e: MouseEvent, id: string, kind: OptionMenuKind): void {
    if (!ui.canEdit) return
    e.stopPropagation()
    ui.optionMenu = {
      id,
      kind,
      ...anchorOptionMenu(rectOf(e, 'option'), rowCountOf(kind, id), viewport()),
    }
  }

  /**
   * 開任務的起訖日期選擇器，月份跟著對準的那一端（推算後的值）。
   * 有前置、還沒開始的任務，開始日由前置決定、選了也不會生效（規則見 docs/reference/scheduling.md），
   * 所以直接對準結束日；其他任務照舊從開始日填起。
   */
  function openTaskDatePicker(e: MouseEvent, taskId: string): void {
    if (!ui.canEdit) return
    e.stopPropagation()
    const t = taskStore.taskById(taskId)
    if (!t) return
    const p = taskStore.policyOf(taskId)
    const target = p.startBlock ? 'end' : 'start'
    const month = t[target].slice(0, 7)
    // 說明行與本月假日行（新頁才有）算進估高，往上翻開時才不會蓋到觸發元素
    const note = taskPickerNote(p, target)
    const extra = calendarExtra(note ? [EDIT_NOTE_TEXT[note]] : [], holidaysLine(month))
    ui.taskDatePicker = {
      id: taskId,
      target,
      month,
      ...anchorCalendar(rectOf(e, 'taskDate'), viewport(), 'task', extra),
    }
  }

  /** 日期選擇器底部的本月假日那一行（沒有假日回 ''），跟 DatePicker 畫出來的一樣。 */
  function holidaysLine(month: string): string {
    const list = monthHolidayList(month, useWorkCalendarStore().workdays)
    return list.length ? MONTH_HOLIDAYS_TEXT(list.join('、')) : ''
  }

  function toggleRowMenu(e: MouseEvent, taskId: string): void {
    if (!ui.canEdit) return
    e.stopPropagation()
    if (ui.rowMenu?.id === taskId) {
      ui.rowMenu = null
      return
    }
    const note = durationNote(taskStore.policyOf(taskId))
    const extra = rowMenuExtra(note ? EDIT_NOTE_TEXT[note] : '')
    ui.rowMenu = { id: taskId, ...anchorRowMenu(rectOf(e, 'row'), viewport(), extra) }
  }

  function openIssueDatePicker(
    e: MouseEvent,
    id: string,
    field: 'due' | 'done',
    iso: ISODate | '',
    kind: 'issue' | 'task' = 'issue',
  ): void {
    if (!ui.canEdit) return
    e.stopPropagation()
    // 沒填過就從今天所在的月份開始。legacy :2667
    const month = (iso || clock.todayIso).slice(0, 7)
    // 任務模式（完成日）多了說明行：完成日的下限，已完成的再加「清除」為什麼不能用（同 DatePicker 的 iNotes）
    const t = kind === 'task' ? taskStore.taskById(id) : undefined
    const notes = !t
      ? []
      : t.status === 'done'
        ? [PICK_LIMIT_TEXT.doneBeforeStart, PICK_LIMIT_TEXT.doneRequired]
        : [PICK_LIMIT_TEXT.doneBeforeStart]
    ui.issueDatePicker = {
      id,
      field,
      kind,
      month,
      ...anchorCalendar(
        rectOf(e, 'issueDate'),
        viewport(),
        'issue',
        calendarExtra(notes, holidaysLine(month)),
      ),
    }
  }

  return { openOptionMenu, openTaskDatePicker, toggleRowMenu, openIssueDatePicker }
}
