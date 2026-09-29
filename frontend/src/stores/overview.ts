import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  bumpOverviewSort,
  DEFAULT_OVERVIEW_SORT,
  deriveProject,
  groupByPm,
  matchProject,
  pmOptions,
  sortRows,
  timelineRange,
  type OverviewSort,
  type OverviewSortKey,
  type ProjectRow,
} from '@/lib/portfolio'
import { useClockStore } from '@/stores/clock'
import { usePortfolioStore } from '@/stores/portfolio'
import type { LoadState } from '@/types/ui'
import type { Member, ProjectAlert, ProjectStatus } from '@/types/models'

/** 總覽的兩種檢視。 */
export type OverviewView = 'cards' | 'timeline'
/** 總覽頁上的浮層；同時只會開一個。排序選單在兩種檢視共用一個 key（同時只顯示一個面板）。 */
export type OverviewDropdown = 'pm' | 'status' | 'alert' | 'sort'

/** 陣列裡有就拿掉、沒有就加上（多選篩選的切換）。 */
function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

/**
 * 派生層：多專案總覽畫面要的所有狀態與派生值（契約 E）。
 *
 * - 篩選：成員照 Dashboard MemberPicker 的語意——沒勾＝不篩；三組條件之間 AND、組內 OR。
 * - 排序：多鍵，預設 ① 落後百分點↓ ② 到期日↑；欄序跟著排序結果走。
 * - `expandedIds` 與 `panelOpen` 由卡片與時間軸兩種檢視共用，是刻意的：切換檢視時展開狀態延續。
 *   `expandedIds` 依展開先後排列；卡片檢視每條泳道只展開一張（toggleExpandedInLane / keepLastExpandedInLane），時間軸不限。
 * - 整個 store 跨路由保留（spec 7b）：從 Dashboard 回來時篩選、排序、展開、檢視都還在。
 */
export const useOverviewStore = defineStore('overview', () => {
  const pf = usePortfolioStore()
  const clock = useClockStore()

  const pmIds = ref<string[]>([])
  const statuses = ref<ProjectStatus[]>([])
  const alerts = ref<ProjectAlert[]>([])
  const sorts = ref<OverviewSort[]>(DEFAULT_OVERVIEW_SORT.map((s) => ({ ...s })))
  const view = ref<OverviewView>('cards')
  const openDropdown = ref<OverviewDropdown | null>(null)
  const expandedIds = ref<string[]>([])
  const collapsedPmIds = ref<string[]>([])
  const panelOpen = ref(true)
  const loadState = ref<LoadState>('idle')
  const loadError = ref<string | null>(null)

  /** 每個專案配上派生值；今天取時鐘層，跨日自動重算。 */
  const rows = computed<ProjectRow[]>(() =>
    pf.projects.map((p) => ({ p, d: deriveProject(p, clock.todayIso) })),
  )

  const visibleRows = computed(() => {
    const f = { pmIds: pmIds.value, statuses: statuses.value, alerts: alerts.value }
    return sortRows(
      rows.value.filter((r) => matchProject(r, f)),
      sorts.value,
    )
  })

  const grouped = computed(() => groupByPm(visibleRows.value, pf.byId))
  const groups = computed(() => grouped.value.groups)
  /** 查不到 PM 的專案 id：不進任何欄，也不算進計數。 */
  const orphans = computed(() => grouped.value.orphans)

  // 資料有問題時留個線索；畫面上只會少那幾張卡，沒有其他訊息
  watch(
    orphans,
    (ids) => {
      if (ids.length) console.warn('[overview] 找不到專案的 PM', ids)
    },
    { immediate: true },
  )

  /** 當過任一專案 PM 的成員，順序照成員名錄。 */
  const pms = computed<Member[]>(() => {
    const ids = new Set(pf.projects.map((p) => p.pmId))
    return pf.members.filter((m) => ids.has(m.id))
  })

  /** 成員下拉的選項：用全部專案算，不受篩選影響。 */
  const pmOptionList = computed(() => pmOptions(rows.value, pms.value))

  /** 面板標題列的計數；以 groups 為準，和畫面上的卡片數一致。 */
  const counts = computed(() => {
    const all = groups.value.flatMap((g) => g.rows)
    return {
      projects: all.length,
      alerts: all.filter((r) => r.d.alert !== 'none').length,
      pms: groups.value.length,
    }
  })

  const anyFilter = computed(
    () => pmIds.value.length > 0 || statuses.value.length > 0 || alerts.value.length > 0,
  )
  const hasProjects = computed(() => pf.projects.length > 0)
  /** 時間軸範圍：用全部專案算，篩選時時間軸不會跳動。 */
  const range = computed(() => timelineRange(pf.projects, clock.todayIso))

  function togglePm(id: string): void {
    pmIds.value = toggleIn(pmIds.value, id)
  }
  function clearPms(): void {
    pmIds.value = []
  }
  function toggleStatus(s: ProjectStatus): void {
    statuses.value = toggleIn(statuses.value, s)
  }
  function toggleAlert(a: ProjectAlert): void {
    alerts.value = toggleIn(alerts.value, a)
  }
  function clearFilters(): void {
    pmIds.value = []
    statuses.value = []
    alerts.value = []
  }

  /** 點排序鍵：沒在清單裡就用預設方向加到最後，已經在就翻方向（OVERVIEW_SORT_DEFAULT_DIR）。 */
  function bumpSort(k: OverviewSortKey): void {
    sorts.value = bumpOverviewSort(sorts.value, k)
  }
  function dropSort(k: OverviewSortKey): void {
    sorts.value = sorts.value.filter((s) => s.k !== k)
  }
  /** 回到預設排序；複製一份，別讓常數被後續 bump 改到。 */
  function resetSort(): void {
    sorts.value = DEFAULT_OVERVIEW_SORT.map((s) => ({ ...s }))
  }

  function setView(v: OverviewView): void {
    view.value = v
    openDropdown.value = null
  }

  function toggleDropdown(k: OverviewDropdown): void {
    openDropdown.value = openDropdown.value === k ? null : k
  }
  function closeDropdown(): void {
    openDropdown.value = null
  }

  function toggleExpanded(id: string): void {
    expandedIds.value = toggleIn(expandedIds.value, id)
  }
  function isExpanded(id: string): boolean {
    return expandedIds.value.includes(id)
  }
  /**
   * 卡片檢視：同一條泳道（同一位 PM）同時只展開一張，照 iTunes 專輯網格的列下展開——
   * 速覽抽屜只有一個箭頭，兩張同時展開時第二個抽屜對不回自己的卡片。
   * 展開新的一張時收起 laneIds 裡的其他張；已展開的再點一次就收合。
   */
  function toggleExpandedInLane(id: string, laneIds: readonly string[]): void {
    if (isExpanded(id)) {
      expandedIds.value = expandedIds.value.filter((x) => x !== id)
      return
    }
    expandedIds.value = [...expandedIds.value.filter((x) => !laneIds.includes(x)), id]
  }
  /** 從時間軸（可多張展開）切回卡片時，同泳道若有多張展開，只留最後展開的那張。 */
  function keepLastExpandedInLane(laneIds: readonly string[]): void {
    const open = expandedIds.value.filter((x) => laneIds.includes(x))
    if (open.length < 2) return
    const last = open[open.length - 1]
    expandedIds.value = expandedIds.value.filter((x) => !laneIds.includes(x) || x === last)
  }

  function toggleGroup(pmId: string): void {
    collapsedPmIds.value = toggleIn(collapsedPmIds.value, pmId)
  }
  function isCollapsed(pmId: string): boolean {
    return collapsedPmIds.value.includes(pmId)
  }

  return {
    pmIds,
    statuses,
    alerts,
    sorts,
    view,
    openDropdown,
    expandedIds,
    collapsedPmIds,
    panelOpen,
    loadState,
    loadError,
    rows,
    visibleRows,
    groups,
    orphans,
    pms,
    pmOptionList,
    counts,
    anyFilter,
    hasProjects,
    range,
    togglePm,
    clearPms,
    toggleStatus,
    toggleAlert,
    clearFilters,
    bumpSort,
    dropSort,
    resetSort,
    setView,
    toggleDropdown,
    closeDropdown,
    toggleExpanded,
    isExpanded,
    toggleExpandedInLane,
    keepLastExpandedInLane,
    toggleGroup,
    isCollapsed,
  }
})
