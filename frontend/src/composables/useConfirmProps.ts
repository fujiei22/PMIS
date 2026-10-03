import { computed, type ComputedRef } from 'vue'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore, type ConfirmKind, type ConfirmState } from '@/stores/ui'

/**
 * 餵給 `ConfirmDialog` 的一整包 props + 事件處理（契約 H）。
 * `open / step / title / body / extra / confirmLabel / altLabel` 對應元件的 props，
 * `onNext / onConfirm / onAlt / onCancel` 是 Vue 幫 emits 產的 listener prop，
 * 所以 `DashboardView` 一句 `v-bind` 就接得起來。
 */
export interface ConfirmView {
  open: boolean
  step: 1 | 2
  title: string
  body: string
  /** 內文之外的補充行（例：上鎖時還沒有基準的任務數）；沒有就不畫。 */
  extra?: string
  confirmLabel: string
  /** 第一步的次要動作鈕（上鎖時「沿用原本的基準」）；沒有就不畫。 */
  altLabel?: string
  onNext: () => void
  onConfirm: () => void
  onAlt?: () => void
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
  /** 第一步的另一種做法（次要動作鈕），按下同樣先關掉確認框再執行。 */
  alt?: { label: string; run: () => void }
}

/** 刪除四種：第一步 / 第二步的動作鈕文字。legacy :1394 / :1404 等四處同字。 */
const DELETE_LABELS = ['繼續刪除', '確認刪除'] as const
/** 第二步的標題：刪除四種共用。legacy :1400 / :1474 / :1501 / :1527 */
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
 * 解鎖不動存的基準，一步就好；上鎖時排程跟原基準有差異才開這個框（沒有差異直接鎖，見 `ui.askBaselineLock`），
 * 讓 PM 選更新（覆蓋原基準、無法復原）或沿用。
 */
const BASELINE_CONFIRM = {
  lockTitle: '要更新計畫基準嗎？',
  lockBody: (n: number) =>
    `目前的排程跟原基準有 ${n} 個任務不同。更新後，原本的基準會被覆蓋，無法復原。`,
  lockExtra: (n: number) => `另有 ${n} 個任務還沒有基準，兩種做法都會用目前的排程。`,
  lockLabel: '更新基準',
  keepLabel: '沿用原本的基準',
  unlockTitle: '解除基準鎖？',
  unlockBody: '進入規劃中：暫時不標示延遲，原本的基準會保留。',
  unlockLabel: '解鎖',
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

  /** 基準鎖兩種的設定：都是一步（第一步的按鈕直接執行）。 */
  function baselineConfig(
    kind: Extract<ConfirmKind, 'baselineLock' | 'baselineUnlock'>,
  ): ConfirmConfig {
    if (kind === 'baselineLock') {
      const missing = taskStore.tasks.filter((t) => !taskStore.storedBaseline(t.id)).length
      return {
        steps: 1,
        title1: BASELINE_CONFIRM.lockTitle,
        body1: BASELINE_CONFIRM.lockBody(taskStore.baselineDiffCount),
        title2: '',
        body2: '',
        labels: [BASELINE_CONFIRM.lockLabel, BASELINE_CONFIRM.lockLabel],
        extra: missing ? BASELINE_CONFIRM.lockExtra(missing) : undefined,
        run: () => void taskStore.lockBaseline('update'),
        alt: { label: BASELINE_CONFIRM.keepLabel, run: () => void taskStore.lockBaseline('keep') },
      }
    }
    return {
      steps: 1,
      title1: BASELINE_CONFIRM.unlockTitle,
      body1: BASELINE_CONFIRM.unlockBody,
      title2: '',
      body2: '',
      labels: [BASELINE_CONFIRM.unlockLabel, BASELINE_CONFIRM.unlockLabel],
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
    const alt = cfg.alt
    return {
      open: true,
      step: c.step,
      title: c.step === 2 ? cfg.title2 : cfg.title1,
      body: c.step === 2 ? cfg.body2 : cfg.body1,
      extra: c.step === 1 ? cfg.extra : undefined,
      confirmLabel: cfg.labels[c.step - 1]!,
      altLabel: c.step === 1 ? alt?.label : undefined,
      /** 第一步的動作鈕：兩步的只把步驟推到 2、不動資料（legacy :4012 等）；一步的直接執行。 */
      onNext: () => {
        if (cfg.steps === 1) confirm()
        else if (ui.confirm) ui.confirm = { ...ui.confirm, step: 2 }
      },
      /** 第二步的動作鈕：真的執行。 */
      onConfirm: confirm,
      /** 次要動作鈕：另一種做法，同樣先關掉對話框。 */
      onAlt: alt
        ? () => {
            ui.confirm = null
            alt.run()
          }
        : undefined,
      onCancel: () => {
        ui.confirm = null
      },
    }
  })
}
