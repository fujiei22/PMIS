import { computed, type ComputedRef } from 'vue'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 餵給 `ConfirmDialog` 的一整包 props + 事件處理（契約 H）。
 * `open / step / title / body / extra / confirmLabel` 對應元件的 props，
 * `onNext / onConfirm / onCancel` 是 Vue 幫 emits 產的 listener prop，
 * 所以 `DashboardView` 一句 `v-bind` 就接得起來。
 */
export interface ConfirmView {
  open: boolean
  step: 1 | 2
  title: string
  body: string
  /** 內文之外的補充行；四種刪除目前都不用，留給之後的新 kind。 */
  extra?: string
  confirmLabel: string
  onNext: () => void
  onConfirm: () => void
  onCancel: () => void
}

/** 第一步 / 第二步的動作鈕文字。legacy :1394 / :1404 等四處同字。 */
const CONFIRM_LABEL = { 1: '繼續刪除', 2: '確認刪除' } as const
/** 第二步的標題四種共用。legacy :1400 / :1474 / :1501 / :1527 */
const STEP2_TITLE = '再次確認'
/** 第一步的標題。legacy :1517（任務）/ :1390（分類）/ :1464（相依）/ :1491（Issue） */
const STEP1_TITLE = {
  task: '刪除任務？',
  group: '刪除分類？',
  dep: '刪除串接關係？',
  issue: '刪除 Issue？',
} as const

/**
 * 把 `ui.confirm`（只有 kind / id / step / label）攤成對話框要的文案與動作。
 * 六個開啟端只寫 `ui.confirm`，不知道文案長怎樣；`ConfirmDialog` 只收 props，不知道 kind。
 * 文案逐字取自 legacy/Dashboard.html 的四份同構 sc-if（:1385-1535）。
 */
export function useConfirmProps(): ComputedRef<ConfirmView | null> {
  const ui = useUiStore()
  const taskStore = useTaskStore()
  const issueStore = useIssueStore()

  return computed<ConfirmView | null>(() => {
    const c = ui.confirm
    if (!c) return null

    // 對話框裡要提到的名稱；相依用開啟時帶進來的 label（「A → B」）。
    const name =
      c.kind === 'task'
        ? (taskStore.taskById(c.id)?.name ?? '')
        : c.kind === 'group'
          ? (taskStore.groupById(c.id)?.name ?? '')
          : c.kind === 'issue'
            ? (issueStore.byId(c.id)?.title ?? '')
            : (c.label ?? '')

    // 會被一起刪掉的附帶項目數：任務算 Issue 筆數、分類算任務數。
    const n =
      c.kind === 'task'
        ? issueStore.byTask(c.id).length
        : c.kind === 'group'
          ? taskStore.tasks.filter((t) => t.groupId === c.id).length
          : 0

    const step1Body = {
      task: `將刪除任務「${name}」，同時移除其 ${n} 筆 Issue 與所有串接關係。`,
      group: `將刪除分類「${name}」及其底下 ${n} 個任務（含這些任務的 Issue 與串接關係）。`,
      dep: `將移除「${name}」的前後相依關係，任務本身不受影響。`,
      issue: `將刪除「${name}」，其描述、對策與測試環境紀錄都會一併移除。`,
    }[c.kind]

    // 第二步：分類要再提一次任務數，相依不寫「無法復原」（線刪了可以重拉），其餘共用。
    const step2Body =
      c.kind === 'group'
        ? `此操作無法復原。確定要刪除「${name}」與其中的 ${n} 個任務嗎？`
        : c.kind === 'dep'
          ? `確定要刪除「${name}」這條串接線嗎？`
          : `此操作無法復原。確定要永久刪除「${name}」嗎？`

    return {
      open: true,
      step: c.step,
      title: c.step === 2 ? STEP2_TITLE : STEP1_TITLE[c.kind],
      body: c.step === 1 ? step1Body : step2Body,
      extra: undefined,
      confirmLabel: CONFIRM_LABEL[c.step],
      /** 第一步的「繼續刪除」：只把步驟推到 2，不動資料。legacy :4012 等 */
      onNext: () => {
        if (ui.confirm) ui.confirm = { ...ui.confirm, step: 2 }
      },
      /** 第二步的「確認刪除」：四種各自交給對應 store。legacy :4013 / :4066 / :4076 / :4082 */
      onConfirm: () => {
        ui.confirm = null
        if (c.kind === 'task') taskStore.removeTask(c.id)
        else if (c.kind === 'group') taskStore.removeGroup(c.id)
        else if (c.kind === 'dep') taskStore.removeDep(c.id)
        else issueStore.removeIssue(c.id)
      },
      onCancel: () => {
        ui.confirm = null
      },
    }
  })
}
