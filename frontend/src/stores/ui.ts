import { defineStore } from 'pinia'
import type { LoadState } from '@/types/ui'
import { computed, ref, watch } from 'vue'
import { ApiError, type ApiErrorCode } from '@/api/types'
import { newId } from '@/lib/id'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useProjectStore } from '@/stores/project'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useWorkCalendarStore } from '@/stores/workCalendar'
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
  /** native：手指觸發的平移交給瀏覽器原生捲動，這裡只記位移、判斷是不是「點一下空白處」。 */
  | { kind: 'pan'; x0: number; y0: number; sl: number; st: number; moved: number; native: boolean }

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
  'priority' | 'status' | 'group' | 'ipri' | 'iitem' | 'istatus' | 'itask' | 'icreator' | 'iowner'

/** 任務 ↔ Issue 切換動畫的長度（ms）。legacy `navAnim()` :2270 */
const NAV_ANIM_MS = 280
/** 甘特一天的預設寬度（px）；登出重置時回到它。 */
const DEFAULT_DAY_WIDTH = 32

/** 三個面板都展開（`panelOff` 的初始值）。 */
function noPanelsOff(): { gantt: boolean; kanban: boolean; issues: boolean } {
  return { gantt: false, kanban: false, issues: false }
}

/** 錯誤條最多留幾筆、同 label 多久內算同一筆（契約 C）。 */
const MAX_ERRORS = 5
const MERGE_WINDOW_MS = 5000

/** 懸空旗標的位元（review F8，同 `selection.ts` 的寫法）。 */
const GONE_DETAIL = 1
const GONE_FROM = 2
const GONE_CONFIRM = 4
const GONE_DEP_EDIT = 8
const GONE_PICKER = 16
const GONE_ROW_MENU = 32

/** api 載入的四個狀態；定義搬到 types/ui.ts，這裡轉出去給既有的 import 用。 */
export type { LoadState } from '@/types/ui'

/** 指向某個實體的確認（刪除類）：實體被刪掉時確認框要跟著關（懸空清理）。 */
export type EntityConfirmKind = 'task' | 'group' | 'issue' | 'dep'
/**
 * 確認框的種類：四種刪除，加上基準鎖的上鎖／解鎖（整個專案一把鎖，沒有實體 id）。
 * 文案與步數在 `composables/useConfirmProps.ts`。
 */
export type ConfirmKind = EntityConfirmKind | 'baselineLock' | 'baselineUnlock'
/** `ui.confirm` 的內容：刪除類帶 id（相依另帶顯示用的 label），基準鎖沒有 id。 */
export type ConfirmState =
  | { kind: EntityConfirmKind; id: string; step: 1 | 2; label?: string }
  | { kind: 'baselineLock' | 'baselineUnlock'; step: 1 | 2 }

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
  const dayWidth = ref(DEFAULT_DAY_WIDTH)
  /** 滑桿拖動中；true 的 160ms 內關掉甘特條的 transition，免得跟著補間。 */
  const zooming = ref(false)
  /** 三個面板的收合狀態。legacy `panelOff` :1579 */
  const panelOff = ref(noPanelsOff())
  /**
   * 甘特左欄展開：平板直向（< 900px）左欄平常縮成只寫工期的窄版，展開就回到完整寬度（起訖日＋工期）。
   * 900px 以上左欄一律完整，不看這個值。
   */
  const ganttLeftExpanded = ref(false)
  /**
   * 左欄的列用完整寫法（起訖日＋工期）。GanttPanel 讓它跟 ganttLeftExpanded 同時切；
   * 膠囊寬度從舊寫法補間到新寫法（跟左欄寬度同一組時長與曲線）由 GanttTaskRow 負責，
   * 補間途中裁掉超出的字，不會蓋住任務名、任務名寬度也一路單調。
   */
  const ganttLeftDates = ref(false)

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
  /** 任務 ↔ Issue 切換的方向動畫。legacy `_nav` :2270 */
  const navAnim = ref<'in' | 'back' | null>(null)

  /**
   * 確認框：兩步刪除（legacy confirmDel / confirmGrp / confirmDep / confirmIssue :4082-4100），
   * 以及基準鎖的上鎖（一步）／解鎖（兩步）。步數與文案見 `useConfirmProps`。
   */
  const confirm = ref<ConfirmState | null>(null)
  /** 相依編輯器針對的 taskId。legacy `depEditFor` :1576 */
  const depEditFor = ref<string | null>(null)

  /** 選項選單（含視窗邊界翻轉後的座標）。legacy `openOpt` :2671 */
  const optionMenu = ref<{
    id: string
    kind: OptionMenuKind
    left: number
    top: number
  } | null>(null)
  /**
   * 甘特任務列「⋮」開的動作選單（工期 ±1 天、相依設定、刪除）。新頁自己的：legacy 是 hover 撐開快捷鈕，
   * 點任務只想標記時很干擾，改成動作都收進這個選單（user 選的 L 稿提案 A）。
   */
  const rowMenu = ref<{ id: string; left: number; top: number } | null>(null)
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

  // ── 唯讀（F2）──────────────────────────────────────────────────────────────
  /**
   * 登入者能不能改這個專案（後端算，存在 project store）。元件讀它藏掉入口；
   * 開確認框 / 相依編輯器 / 負責人選擇器 / 就地編輯一律走下面的 action，唯讀時不開。
   * 資料層另外再擋一次（task / issue / comment 的寫入 action），這裡只管畫面。
   */
  const canEdit = computed(() => useProjectStore().canEdit)

  /** 兩步刪除確認的第一步；唯讀時不開。 */
  function askDelete(kind: EntityConfirmKind, id: string, label?: string): void {
    if (!canEdit.value) return
    confirm.value = label === undefined ? { kind, id, step: 1 } : { kind, id, step: 1, label }
  }

  /**
   * 基準鎖的確認：上鎖中開「解鎖」（兩步），規劃中開「上鎖」（一步）。
   * 唯讀時不開；日曆不是 ready 時上鎖也不開（鎖下去的基準會是只排除週末的錯誤排程，store 也會擋）。
   */
  function askBaselineLock(): void {
    if (!canEdit.value) return
    if (useProjectStore().meta.baselineLockedOn) {
      confirm.value = { kind: 'baselineUnlock', step: 1 }
      return
    }
    if (useWorkCalendarStore().status !== 'ready') return
    confirm.value = { kind: 'baselineLock', step: 1 }
  }

  /** 開相依編輯器；唯讀時不開。 */
  function openDepEditor(taskId: string): void {
    if (!canEdit.value) return
    depEditFor.value = taskId
  }

  /** 展開 / 收合詳情裡的負責人選擇器；唯讀時只能收、不能開。 */
  function toggleAssigneePicker(taskId: string): void {
    if (pickerFor.value === taskId) {
      pickerFor.value = null
      return
    }
    if (!canEdit.value) return
    pickerFor.value = taskId
  }

  /** 進就地編輯（分類名 / 任務名 / Issue 標題 / 詳情標題）；唯讀時不進。 */
  function startEdit(kind: 'g' | 't' | 'i' | 'dt', id: string): void {
    if (!canEdit.value) return
    editing.value = { kind, id }
  }

  // ── 拖曳共享狀態（S2 定型別、S3 元件讀、S5 填值）────────────────────────────
  const drag = ref<DragState | null>(null)
  const linkLine = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const nearTaskId = ref<string | null>(null)
  const hoverTaskId = ref<string | null>(null)

  let navTimer: ReturnType<typeof setTimeout> | undefined

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

  /**
   * 關詳細視窗。legacy `detailClose` :3810。
   * 關閉動畫由 DetailModal 的 <Transition> 負責（離場中的畫面停在關閉前的樣子），store 不再留快照。
   */
  function closeDetail(): void {
    if (!detail.value) return
    detail.value = null
    pickerFor.value = null
    editing.value = null
    openDropdown.value = null
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

  /**
   * 離開 Dashboard 時清掉所有暫態浮層：詳細視窗、確認框、相依編輯器、選單、
   * 日期選擇器、Lightbox、下拉、就地編輯。
   *
   * store 活得比頁面久，不清的話從總覽回來，上次開著的詳細視窗會自己跳出來。
   * `panelOff`、`collapsedGroups`、`dayWidth`、`ganttLeftExpanded` 是使用者的版面偏好，刻意保留。
   */
  function resetTransient(): void {
    detail.value = null
    navAnim.value = null
    clearTimeout(navTimer)
    confirm.value = null
    depEditFor.value = null
    optionMenu.value = null
    rowMenu.value = null
    taskDatePicker.value = null
    issueDatePicker.value = null
    lightbox.value = null
    closeAllPopups()
    pickerFor.value = null
    editing.value = null
    // 拖曳 / hover / 連線這些跟著指標事件走的暫態：離開頁面時沒有 pointerup / mouseleave，要手動清
    drag.value = null
    linkLine.value = null
    nearTaskId.value = null
    hoverTaskId.value = null
    zooming.value = false
    // 錯誤條是這一趟操作的結果，回來時不該再出現
    errors.value = []
  }

  /**
   * 登出 / 換使用者：整個回到剛開網頁的樣子（`composables/useSession.ts` 的 `resetSession()`）。
   * 比 `resetTransient` 多清載入狀態與版面偏好：下一位不該沿用上一位的縮放、面板收合、分類收合
   * （收合的分類 id 也是上一位看的專案的）；載入狀態回 idle，下一位進 Dashboard 是「載入中」，不是背景重載。
   */
  function reset(): void {
    resetTransient()
    loadState.value = 'idle'
    loadError.value = null
    dayWidth.value = DEFAULT_DAY_WIDTH
    panelOff.value = noPanelsOff()
    ganttLeftExpanded.value = false
    ganttLeftDates.value = false
    collapsedGroups.value = new Set()
    expandedIssues.value = {}
  }

  // ── 懸空 id 清理（契約 E）──────────────────────────────────────────────────

  /**
   * 這個 kind / id 的實體還在嗎。基準鎖的確認沒有實體（整個專案一把鎖），一律算在，
   * 懸空清理不會關掉它。
   */
  function exists(kind: ConfirmKind, id?: string): boolean {
    if (kind === 'baselineLock' || kind === 'baselineUnlock') return true
    if (id === undefined) return false
    const tasks = useTaskStore()
    if (kind === 'task') return !!tasks.taskById(id)
    if (kind === 'group') return !!tasks.groupById(id)
    if (kind === 'dep') return tasks.deps.some((d) => d.id === id)
    return !!useIssueStore().byId(id)
  }

  /**
   * 指向已刪實體的浮層狀態一律關掉。
   *
   * 資料層不再回頭清 ui（契約 E）：不管刪除是本地發起、樂觀還原，還是別的
   * client 推來的事件，都由這條 watch 收尾。`flush: 'sync'` 讓畫面不會有任何
   * 一個 tick 停在不存在的 id 上（review M7）。
   * 清理清單：`detail`（含 `detail.from`）、`confirm`、`depEditFor`、`pickerFor`、`rowMenu`。
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
        (c && !exists(c.kind, 'id' in c ? c.id : undefined) ? GONE_CONFIRM : 0) |
        (depEditFor.value && !exists('task', depEditFor.value) ? GONE_DEP_EDIT : 0) |
        (pickerFor.value && !exists('task', pickerFor.value) ? GONE_PICKER : 0) |
        (rowMenu.value && !exists('task', rowMenu.value.id) ? GONE_ROW_MENU : 0)
      )
    },
    (gone) => {
      if (gone & GONE_DETAIL) closeDetail()
      else if (gone & GONE_FROM && detail.value) detail.value.from = null
      if (gone & GONE_CONFIRM) confirm.value = null
      if (gone & GONE_DEP_EDIT) depEditFor.value = null
      if (gone & GONE_PICKER) pickerFor.value = null
      if (gone & GONE_ROW_MENU) rowMenu.value = null
    },
    { flush: 'sync' },
  )

  /**
   * 變成唯讀（例如背景重載回來時 PM 已經換人）：開著的編輯類浮層與就地編輯一律關掉，
   * 不留「看得到卻不能用」的東西。詳細視窗、Lightbox、下拉這些看的東西不動。
   */
  watch(
    canEdit,
    (on) => {
      if (on) return
      editing.value = null
      confirm.value = null
      depEditFor.value = null
      pickerFor.value = null
      optionMenu.value = null
      rowMenu.value = null
      taskDatePicker.value = null
      issueDatePicker.value = null
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
    ganttLeftExpanded,
    ganttLeftDates,
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
    navAnim,
    openDetail,
    closeDetail,
    detailBack,
    resetTransient,
    reset,
    confirm,
    depEditFor,
    canEdit,
    askDelete,
    askBaselineLock,
    openDepEditor,
    toggleAssigneePicker,
    startEdit,
    optionMenu,
    rowMenu,
    taskDatePicker,
    issueDatePicker,
    lightbox,
    expandedIssues,
    drag,
    linkLine,
    nearTaskId,
    hoverTaskId,
  }
})
