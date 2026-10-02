import { computed, type ComputedRef } from 'vue'
import { isLate } from '@/lib/schedule'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore, type ConfirmKind, type ConfirmState } from '@/stores/ui'

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
  /** 內文之外的補充行（例：解鎖時目前延遲幾個任務）；沒有就不畫。 */
  extra?: string
  confirmLabel: string
  onNext: () => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 一種確認框的設定。`steps: 1` 的只有第一步：ConfirmDialog 第一步的按鈕（`next`）直接執行；
 * `steps: 2` 的第一步推到第二步，第二步（標題轉紅、紅色按鈕）才執行。
 */
interface ConfirmConfig {
  steps: 1 | 2
  title1: string
  body1: string
  title2: string
  body2: string
  /** 第一步 / 第二步的動作鈕文字；一步的只用 [0]。 */
  labels: readonly [string, string]
  extra?: string
  /** 真的執行（確認框已經先關掉）。 */
  run: () => void
}

/** 刪除四種：第一步 / 第二步的動作鈕文字。legacy :1394 / :1404 等四處同字。 */
const DELETE_LABELS = ['繼續刪除', '確認刪除'] as const
/** 第二步的標題：刪除四種與解鎖共用。legacy :1400 / :1474 / :1501 / :1527 */
const STEP2_TITLE = '再次確認'
/** 刪除的第一步標題。legacy :1517（任務）/ :1390（分類）/ :1464（相依）/ :1491（Issue） */
const DELETE_TITLE = {
  task: '刪除任務？',
  group: '刪除分類？',
  dep: '刪除串接關係？',
  issue: '刪除 Issue？',
} as const

/**
 * 基準鎖的文案（規則見 docs/reference/scheduling.md〈基準與基準鎖〉）。
 * 上鎖不會丟掉任何東西（解鎖時基準本來就跟著排程走），一步就好；
 * 解鎖之後，下一次編輯寫回時存的基準就會改成推算起訖，原本的基準找不回來，所以兩步。
 */
const BASELINE_CONFIRM = {
  lockTitle: '鎖定計畫基準？',
  lockBody: '把目前的排程鎖成基準，之後晚於基準的任務會標成已延遲。',
  lockLabel: '鎖定',
  unlockTitle: '解除基準鎖？',
  unlockBody: '解鎖後基準跟著排程走，不再標示延遲。',
  unlockExtra: (n: number) => `目前 ${n} 個任務已延遲`,
  unlockBody2: '解鎖後，下一次編輯就會把基準改成目前的排程，原本的基準無法復原。',
  unlockLabels: ['繼續', '確認解鎖'] as const,
}

/**
 * 把 `ui.confirm`（只有 kind / id / step / label）攤成對話框要的文案與動作。
 * 開啟端只寫 `ui.confirm`，不知道文案長怎樣；`ConfirmDialog` 只收 props，不知道 kind。
 * 刪除的文案逐字取自 legacy/Dashboard.html 的四份同構 sc-if（:1385-1535）。
 */
export function useConfirmProps(): ComputedRef<ConfirmView | null> {
  const ui = useUiStore()
  const taskStore = useTaskStore()
  const issueStore = useIssueStore()

  /** 刪除四種的設定。 */
  function deleteConfig(c: Extract<ConfirmState, { id: string }>): ConfirmConfig {
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

    const body1 = {
      task: `將刪除任務「${name}」，同時移除其 ${n} 筆 Issue 與所有串接關係。`,
      group: `將刪除分類「${name}」及其底下 ${n} 個任務（含這些任務的 Issue 與串接關係）。`,
      dep: `將移除「${name}」的前後相依關係，任務本身不受影響。`,
      issue: `將刪除「${name}」，其描述、對策與測試環境紀錄都會一併移除。`,
    }[c.kind]

    // 第二步：分類要再提一次任務數，相依不寫「無法復原」（線刪了可以重拉），其餘共用。
    const body2 =
      c.kind === 'group'
        ? `此操作無法復原。確定要刪除「${name}」與其中的 ${n} 個任務嗎？`
        : c.kind === 'dep'
          ? `確定要刪除「${name}」這條串接線嗎？`
          : `此操作無法復原。確定要永久刪除「${name}」嗎？`

    return {
      steps: 2,
      title1: DELETE_TITLE[c.kind],
      body1,
      title2: STEP2_TITLE,
      body2,
      labels: DELETE_LABELS,
      // 四種各自交給對應 store。legacy :4013 / :4066 / :4076 / :4082
      run: () => {
        if (c.kind === 'task') taskStore.removeTask(c.id)
        else if (c.kind === 'group') taskStore.removeGroup(c.id)
        else if (c.kind === 'dep') taskStore.removeDep(c.id)
        else issueStore.removeIssue(c.id)
      },
    }
  }

  /** 基準鎖兩種的設定。 */
  function baselineConfig(
    kind: Extract<ConfirmKind, 'baselineLock' | 'baselineUnlock'>,
  ): ConfirmConfig {
    if (kind === 'baselineLock')
      return {
        steps: 1,
        title1: BASELINE_CONFIRM.lockTitle,
        body1: BASELINE_CONFIRM.lockBody,
        title2: '',
        body2: '',
        labels: [BASELINE_CONFIRM.lockLabel, BASELINE_CONFIRM.lockLabel],
        run: () => void taskStore.lockBaseline(),
      }
    const late = taskStore.tasks.filter((t) => isLate(t)).length
    return {
      steps: 2,
      title1: BASELINE_CONFIRM.unlockTitle,
      body1: BASELINE_CONFIRM.unlockBody,
      title2: STEP2_TITLE,
      body2: BASELINE_CONFIRM.unlockBody2,
      labels: BASELINE_CONFIRM.unlockLabels,
      extra: late ? BASELINE_CONFIRM.unlockExtra(late) : undefined,
      run: () => void taskStore.unlockBaseline(),
    }
  }

  return computed<ConfirmView | null>(() => {
    const c = ui.confirm
    if (!c) return null
    // 刪除類帶實體 id；基準鎖沒有
    const cfg = 'id' in c ? deleteConfig(c) : baselineConfig(c.kind)

    /** 執行：先關掉對話框，再交給 store。 */
    const confirm = () => {
      ui.confirm = null
      cfg.run()
    }
    return {
      open: true,
      step: c.step,
      title: c.step === 2 ? cfg.title2 : cfg.title1,
      body: c.step === 2 ? cfg.body2 : cfg.body1,
      extra: c.step === 1 ? cfg.extra : undefined,
      confirmLabel: cfg.labels[c.step - 1]!,
      /** 第一步的動作鈕：兩步的只把步驟推到 2、不動資料（legacy :4012 等）；一步的直接執行。 */
      onNext: () => {
        if (cfg.steps === 1) confirm()
        else if (ui.confirm) ui.confirm = { ...ui.confirm, step: 2 }
      },
      /** 第二步的動作鈕：真的執行。 */
      onConfirm: confirm,
      onCancel: () => {
        ui.confirm = null
      },
    }
  })
}
