import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { ApiError, type ApiErrorCode } from '@/api/types'
import { newId } from '@/lib/id'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import type { DropTarget } from '@/types/models'

/**
 * 七種拖曳的共享狀態。S2 只定型別與初始值，S3 的元件讀它算樣式，S5 才真的填值。
 * 對照 legacy：startBar :2597、startLink :2607、onGrip :2877、分類重排 :2772、onPanStart :4112。
 */
export type DragState =
  | {
      kind: 'move' | 'resL' | 'resR'
      id: string
      x0: number
      sl0: number
      s0: number
      e0: number
      last: number
    }
  | { kind: 'link'; id: string; side: 'L' | 'R'; ax: number; ay: number }
  | { kind: 'reorder'; id: string; over: DropTarget | null; lastAt: number; lastY: number }
  | { kind: 'greorder'; id: string; lastAt: number }
  | { kind: 'pan'; x0: number; y0: number; sl: number; st: number; moved: number }

/** 頂部與面板上所有互斥下拉的 key。legacy `ddOpen` :1573 */
export type DropdownKey =
  | 'status'
  | 'prio'
  | 'group'
  | 'issue'
  | 'fmode'
  | 'icls'
  | 'ist'
  | 'ksort'
  | 'igroup'
  | 'isort'
  | 'cdate'
  | 'cmem'

/**
 * 選項選單能改的欄位。legacy `openOpt(e, id, kind)` 的 kind :2671。
 * S4 追加的具名型別；欄位本身與 §介面契約 D 的 `optionMenu.kind` 完全相同。
 */
export type OptionMenuKind =
  | 'priority'
  | 'status'
  | 'group'
  | 'ipri'
  | 'iitem'
  | 'istatus'
  | 'itask'
  | 'icreator'
  | 'iowner'

/** 詳細視窗關閉動畫的長度（ms）。legacy `hold()` :1741 */
const DETAIL_HOLD_MS = 320
/** 任務 ↔ Issue 切換動畫的長度（ms）。legacy `navAnim()` :2270 */
const NAV_ANIM_MS = 280
/** 錯誤條最多留幾筆、同 label 多久內算同一筆（契約 C）。 */
const MAX_ERRORS = 5
const MERGE_WINDOW_MS = 5000

/** 懸空旗標的位元（review F8，同 `selection.ts` 的寫法）。 */
const GONE_DETAIL = 1
const GONE_FROM = 2
const GONE_CONFIRM = 4
const GONE_DEP_EDIT = 8
const GONE_PICKER = 16

/** api 載入的四個狀態（契約 C）。 */
export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

/** 錯誤條上的一筆；`message` 是 server 原文，只進 console，不上畫面（review M2）。 */
export interface UiError {
  id: string
  label: string
  code: ApiErrorCode
  message: string
  cause: unknown
  at: number
  count: number
}

/**
 * 純畫面狀態：時鐘、縮放、浮層、拖曳。
 * 這裡不放任何業務資料——資料在 task / issue / comment store。
 */
export const useUiStore = defineStore('ui', () => {
  /** 時鐘在 `stores/clock.ts`（契約 C）；ui 自己只用它算錯誤條的時間戳。 */
  const clock = useClockStore()

  // ── 載入狀態與錯誤條（契約 C）────────────────────────────────────────────
  /** 整包專案資料的載入狀態；DashboardView 依它切 LoadingState。 */
  const loadState = ref<LoadState>('idle')
  /** 載入失敗時給使用者看的中文；重試成功就清掉。 */
  const loadError = ref<string | null>(null)
  /** 寫入失敗的提示，最多 5 筆、新的在前；不自動關閉（review M3）。 */
  const errors = ref<UiError[]>([])

  /**
   * 記一筆寫入失敗。同一個 label 在 5 秒內只累加 count，不洗版。
   *
   * `at` 取 `clock.now`（review Minor）——它每 60 秒才走一次，
   * 所以實務上「同一次 tick 內的同 label」會合併成一筆，這是刻意的。
   */
  function pushError(e: { label: string; error: unknown }): void {
    // review M3：畫面只給 label + code 的中文，原文留給開發者
    console.error('[api]', e.label, e.error)
    const at = clock.now
    const hit = errors.value.find((x) => x.label === e.label && at - x.at < MERGE_WINDOW_MS)
    if (hit) {
      hit.count++
      hit.at = at
      return
    }
    const err = e.error
    errors.value = [
      {
        id: newId(),
        label: e.label,
        code: err instanceof ApiError ? err.code : 'unknown',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
        at,
        count: 1,
      },
      ...errors.value,
    ].slice(0, MAX_ERRORS)
  }

  function dismissError(id: string): void {
    errors.value = errors.value.filter((e) => e.id !== id)
  }

  /** 甘特圖一天的寬度（px）。legacy `dayW()` :1898 */
  const dayWidth = ref(32)
  /** 滑桿拖動中；true 的 160ms 內關掉甘特條的 transition，免得跟著補間。 */
  const zooming = ref(false)
  /** 三個面板的收合狀態。legacy `panelOff` :1579 */
  const panelOff = ref({ gantt: false, kanban: false, issues: false })

  /**
   * 收合中的分類 id。review C5：這是純畫面狀態，不是專案資料——
   * 放在 `Group.collapsed` 的話，改名的 response 或別人送來的 group.updated 事件
   * 會把收合中的分類彈開（契約 A：Group 沒有 collapsed）。
   */
  const collapsedGroups = ref<Set<string>>(new Set())

  /** 收合 / 展開一個分類。legacy `onCaret` :2800 */
  function toggleGroup(id: string): void {
    if (collapsedGroups.value.has(id)) collapsedGroups.value.delete(id)
    else collapsedGroups.value.add(id)
  }

  /**
   * 全部收合 / 全部展開。legacy `toggleAllGroups` :4110。
   *
   * 要收合的分類 id 由呼叫端給（契約 E）：全部展開就傳空陣列。
   * 這樣 ui 不必為了「有哪些分類」去讀 taskStore.groups。
   */
  function setAllCollapsed(ids: string[]): void {
    collapsedGroups.value = new Set(ids)
  }

  const openDropdown = ref<DropdownKey | null>(null)
  const memberPickerOpen = ref(false)
  const filterCalendarOpen = ref(false)

  /** 就地編輯中的目標：分類 / 任務 / Issue / 詳情標題。legacy `editing` :1556 */
  const editing = ref<{ kind: 'g' | 't' | 'i' | 'dt'; id: string } | null>(null)
  /** 詳情裡展開負責人選擇器的 taskId。legacy `pickerFor` :1557 */
  const pickerFor = ref<string | null>(null)

  const detail = ref<{ id: string; kind: 'task' | 'issue'; from: string | null } | null>(null)
  /** 關閉動畫期間還要畫的快照。legacy `_lastDetail` :3066 */
  const lastDetail = ref<{ id: string; kind: 'task' | 'issue' } | null>(null)
  /** 任務 ↔ Issue 切換的方向動畫。legacy `_nav` :2270 */
  const navAnim = ref<'in' | 'back' | null>(null)

  /** 兩步刪除確認。legacy confirmDel / confirmGrp / confirmDep / confirmIssue :4082-4100 */
  const confirm = ref<{
    kind: 'task' | 'group' | 'dep' | 'issue'
    id: string
    step: 1 | 2
    label?: string
  } | null>(null)
  /** 相依編輯器針對的 taskId。legacy `depEditFor` :1576 */
  const depEditFor = ref<string | null>(null)

  /** 選項選單（含視窗邊界翻轉後的座標）。legacy `openOpt` :2671 */
  const optionMenu = ref<{
    id: string
    kind: OptionMenuKind
    left: number
    top: number
  } | null>(null)
  /** 甘特列上的起訖日期選擇器。legacy `dCal` :1587 */
  const taskDatePicker = ref<{
    id: string
    target: 'start' | 'end'
    month: string
    left: number
    top: number
  } | null>(null)
  /** Issue 的期限 / 完成日選擇器；kind='task' 時改寫任務的完成日。legacy `openICal` :2663 */
  const issueDatePicker = ref<{
    id: string
    field: 'due' | 'done'
    kind: 'issue' | 'task'
    month: string
    left: number
    top: number
  } | null>(null)
  const lightbox = ref<{ url: string; name: string; size: string } | null>(null)
  /** Issue 卡片是否展開編輯表單。legacy `expIssue` :1566 */
  const expandedIssues = ref<Record<string, boolean>>({})

  // ── 拖曳共享狀態（S2 定型別、S3 元件讀、S5 填值）────────────────────────────
  const drag = ref<DragState | null>(null)
  const linkLine = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const nearTaskId = ref<string | null>(null)
  const hoverTaskId = ref<string | null>(null)
  const rowHoverId = ref<string | null>(null)
  const memberDrag = ref<{ from: string; ids: string[] } | null>(null)

  let navTimer: ReturnType<typeof setTimeout> | undefined
  let holdTimer: ReturnType<typeof setTimeout> | undefined

  /** 夾在 14-32 之間並吸附到 0.25 的倍數。legacy `dayW()` :1898 */
  function setDayWidth(v: number): void {
    dayWidth.value = Math.max(14, Math.min(32, Math.round(v * 4) / 4))
  }

  /** 開一個下拉：同一個 key 再點就關；開啟時關掉成員選單與日曆。legacy :3695 等 */
  function toggleDropdown(key: DropdownKey): void {
    openDropdown.value = openDropdown.value === key ? null : key
    memberPickerOpen.value = false
    filterCalendarOpen.value = false
  }

  /** 成員選單與下拉互斥。legacy `mpOpen` 的 setState :1909 */
  function toggleMemberPicker(): void {
    memberPickerOpen.value = !memberPickerOpen.value
    if (memberPickerOpen.value) {
      openDropdown.value = null
      filterCalendarOpen.value = false
    }
  }

  /** 點到 [data-dd] 以外的地方時全部關掉。legacy `_docDown` :1907 */
  function closeAllPopups(): void {
    openDropdown.value = null
    memberPickerOpen.value = false
    filterCalendarOpen.value = false
  }

  /** 播放任務 ↔ Issue 的切換動畫，280ms 後自動清掉。legacy `navAnim` :2270 */
  function playNavAnim(dir: 'in' | 'back'): void {
    navAnim.value = dir
    clearTimeout(navTimer)
    navTimer = setTimeout(() => {
      navAnim.value = null
    }, NAV_ANIM_MS)
  }

  /**
   * 開詳細視窗。legacy :3067 / :3049 / :3200。
   * 順手把可能擋住視窗的浮層與上一次的留言草稿清掉；
   * fileSel 也清（§不重現的原頁面 bug 2：legacy 的多選狀態會跨任務殘留 :3901）。
   */
  function openDetail(id: string, kind: 'task' | 'issue', from?: string): void {
    pickerFor.value = null
    editing.value = null
    openDropdown.value = null
    const comment = useCommentStore()
    comment.resetDraft()
    comment.fileSel = []
    detail.value = { id, kind, from: from ?? null }
    if (from) playNavAnim('in')
  }

  /** 關詳細視窗；lastDetail 留著讓關閉動畫有東西可畫。legacy `detailClose` :3810 */
  function closeDetail(): void {
    if (detail.value) lastDetail.value = { id: detail.value.id, kind: detail.value.kind }
    detail.value = null
    pickerFor.value = null
    editing.value = null
    openDropdown.value = null
    clearTimeout(holdTimer)
    holdTimer = setTimeout(() => {
      lastDetail.value = null
    }, DETAIL_HOLD_MS)
  }

  /** 從 Issue 詳情返回它的任務詳情；沒有來源就等同關閉。legacy `detailBack` :3807 */
  function detailBack(): void {
    const from = detail.value?.from ?? null
    if (!from) {
      closeDetail()
      return
    }
    openDetail(from, 'task')
    playNavAnim('back')
    // legacy 返回時把選取切回該任務（:3807）；直接改 taskId，不走 selectTask 以免重播捲動
    useSelectionStore().taskId = from
  }

  // ── 懸空 id 清理（契約 E）──────────────────────────────────────────────────

  /** 這個 kind / id 的實體還在嗎。 */
  function exists(kind: 'task' | 'issue' | 'group' | 'dep', id: string): boolean {
    const tasks = useTaskStore()
    if (kind === 'task') return !!tasks.taskById(id)
    if (kind === 'group') return !!tasks.groupById(id)
    if (kind === 'dep') return tasks.deps.some((d) => d.id === id)
    return !!useIssueStore().byId(id)
  }

  /**
   * 指向已刪實體的浮層狀態一律關掉。
   *
   * 資料層不再回頭清 ui（契約 E）：不管刪除是本地發起、乐觀還原，還是別的
   * client 推來的事件，都由這條 watch 收尾。`flush: 'sync'` 讓畫面不會有任何
   * 一個 tick 停在不存在的 id 上（review M7）。
   * 清理清單：`detail`（含 `detail.from`）、`confirm`、`depEditFor`、`pickerFor`。
   *
   * review F8：getter 回位元遮罩（同 `selection.ts`）。原本回一個每次都重建的
   * 物件，等於**每一次資料變動**（連改個名字都算）都要跑一次 callback。
   */
  watch(
    () => {
      const d = detail.value
      const c = confirm.value
      return (
        (d && !exists(d.kind, d.id) ? GONE_DETAIL : 0) |
        (d?.from && !exists('task', d.from) ? GONE_FROM : 0) |
        (c && !exists(c.kind, c.id) ? GONE_CONFIRM : 0) |
        (depEditFor.value && !exists('task', depEditFor.value) ? GONE_DEP_EDIT : 0) |
        (pickerFor.value && !exists('task', pickerFor.value) ? GONE_PICKER : 0)
      )
    },
    (gone) => {
      if (gone & GONE_DETAIL) closeDetail()
      else if (gone & GONE_FROM && detail.value) detail.value.from = null
      if (gone & GONE_CONFIRM) confirm.value = null
      if (gone & GONE_DEP_EDIT) depEditFor.value = null
      if (gone & GONE_PICKER) pickerFor.value = null
    },
    { flush: 'sync' },
  )

  /**
   * 展開中的 Issue 卡另外一條（review F8）：它只跟 Issue 清單有關，
   * 併在上面那條裡會讓任何一筆任務的改動都去掃一次整份 `expandedIssues`。
   * getter 回字串（id 以空白相接）——一樣是 primitive，值沒變就不進 callback。
   */
  watch(
    () =>
      Object.keys(expandedIssues.value)
        .filter((id) => !exists('issue', id))
        .join(' '),
    (gone) => {
      for (const id of gone.split(' ')) if (id) delete expandedIssues.value[id]
    },
    { flush: 'sync' },
  )

  return {
    loadState,
    loadError,
    errors,
    pushError,
    dismissError,
    dayWidth,
    setDayWidth,
    zooming,
    panelOff,
    collapsedGroups,
    toggleGroup,
    setAllCollapsed,
    openDropdown,
    memberPickerOpen,
    filterCalendarOpen,
    toggleDropdown,
    toggleMemberPicker,
    closeAllPopups,
    editing,
    pickerFor,
    detail,
    lastDetail,
    navAnim,
    openDetail,
    closeDetail,
    detailBack,
    confirm,
    depEditFor,
    optionMenu,
    taskDatePicker,
    issueDatePicker,
    lightbox,
    expandedIssues,
    drag,
    linkLine,
    nearTaskId,
    hoverTaskId,
    rowHoverId,
    memberDrag,
  }
})
