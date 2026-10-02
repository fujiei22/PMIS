<script setup lang="ts">
// 頂部固定列：專案名（唯讀時旁邊加灰色「唯讀」tag）、面板捷徑、成員篩選、七個篩選 pill、日期範圍、清除篩選、只顯示篩選結果。
// legacy 對照：模板 :56-292、各 pill 的 label / options :3657-3764。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import ErrorBar from '@/components/common/ErrorBar.vue'
import FilterCalendar from '@/components/layout/FilterCalendar.vue'
import FilterDropdown, { type FilterOption } from '@/components/layout/FilterDropdown.vue'
import MemberPicker from '@/components/layout/MemberPicker.vue'
import { DELAYED, ISSUE_LEVEL, ISSUE_STATUS, PRIORITY, TASK_STATUS } from '@/constants/dashboard'
import { useDeferredPanels } from '@/composables/useDeferredPanels'
import { freezeLeave } from '@/composables/freezeLeave'
import { useDomRegistry } from '@/composables/useDomRegistry'
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'
import { parseDuration } from '@/lib/easing'
import { toggleIn } from '@/lib/filter'
import { fmtDate } from '@/lib/format'
import { useFilterStore } from '@/stores/filter'
import { useMemberStore } from '@/stores/member'
import { useProjectStore } from '@/stores/project'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { IssueLevel, IssueStatus, Priority, TaskStatus } from '@/types/models'

const ui = useUiStore()
const filter = useFilterStore()
const taskStore = useTaskStore()
const project = useProjectStore()
const memberStore = useMemberStore()
const sticky = useStickyOffsetsContext()
const registry = useDomRegistry()
/** 首屏外的面板延後掛載（K1）：捷徑跳到還沒掛的面板前先掛上 */
const deferredPanels = useDeferredPanels()

const rootEl = ref<HTMLElement | null>(null)
watch(rootEl, (el) => sticky.observe('top', el), { immediate: true })

/**
 * 篩選器在標題與右端之間一行放不下時改兩列：篩選器整排移到滿寬的第二列、靠左排（同平板版）。
 *
 * 用量的、不用斷點：預設狀態要 1471px 才放得下，啟用日期範圍多兩顆膠囊（約 250px）、專案名較長時要更寬；
 * 寫死斷點的話，1200～1470（15.6 吋筆電常見寬度）或啟用篩選後，篩選器會在中間自己換行、標籤和下拉被拆開（user 回報）。
 * 量法：同一個同步區塊裡暫時切回單行、不換行（.measuring），看篩選器有沒有溢出，量完立刻還原；
 * 結果與目前是哪一種版型無關，不會在兩種版型之間來回切。
 */
const rowEl = ref<HTMLElement | null>(null)
const filtersEl = ref<HTMLElement | null>(null)
const stacked = ref(false)

/**
 * 篩選器裡實際參與排版的項目：`.fgroup` 是 display: contents，算它的子元素；
 * 浮在外面的（日曆）與正在淡出的日期膠囊 / ～（pinLeaving 釘成 absolute）不算。
 */
function filterItems(box: HTMLElement): HTMLElement[] {
  const items: HTMLElement[] = []
  for (const c of Array.from(box.children) as HTMLElement[]) {
    if (c.classList.contains('fgroup')) items.push(...(Array.from(c.children) as HTMLElement[]))
    else items.push(c)
  }
  return items.filter((el) => !['fixed', 'absolute'].includes(getComputedStyle(el).position))
}

/** 量篩選器在單行時放不放得下，放不下就 `stacked = true`；切 class、量、還原都在同一個同步區塊，不會被畫出來。 */
function measureFit(): void {
  const row = rowEl.value
  const box = filtersEl.value
  if (!row || !box) return
  row.classList.remove('stacked')
  row.classList.add('measuring')
  // 比最右一項的右緣與篩選器右緣（含小數）：只差不到 1px 也會讓 flex 換行，整數的 scrollWidth 量不準
  const edge = box.getBoundingClientRect().right
  const overflow = filterItems(box).some((el) => layoutRight(el) > edge + 0.01)
  row.classList.remove('measuring')
  if (stacked.value) row.classList.add('stacked')
  // 一行 / 兩列要切換：滑到一半的位移補間直接停掉，版型直接到位；
  // 正在淡出的日期膠囊釘的是舊版型的位置（定位基準也會換），直接藏起來
  if (overflow !== stacked.value) {
    cancelSlides()
    for (const el of leavingPills) el.style.visibility = 'hidden'
  }
  stacked.value = overflow
}

/**
 * 篩選項在版面上的右緣，不算位移補間（G7，見下方 slides）的 translateX：
 * 補間途中看得到的位置不是版面位置，拿它判斷放不放得下會誤判。
 */
function layoutRight(el: HTMLElement): number {
  const right = el.getBoundingClientRect().right
  if (!slides.has(el)) return right
  return right - new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
}

/**
 * 一行時篩選項變寬的位移補間（動畫稽核 G7）。
 * 一行時篩選器靠右排（flex-end），某一項變寬（選日期「介於」多出兩顆膠囊與「～」、下拉標籤多了數字），
 * 它左邊的整排往左移；原本一幀跳過去（1920 選「介於」整排 −248px），改成 FLIP 滑過去：
 * 篩選條件一變，DOM 更新前記下每一項看得到的右緣，更新後量新的右緣，
 * 先用 translateX 移回舊位置，再補間回 0（Web Animations，`--t-panel` / `--ease`）。
 *
 * 比右緣、不比左緣：一行時變寬是左緣往左長、右緣不動（同 popAlign 的 end），變寬的那一項自己不動，
 * 它開著的選單（錨在右緣）也就不會被帶著跑。新出現的項目（日期膠囊）沒有舊位置，直接出現在新位置。
 * 只在這次更新前後都是一行時做：縮放視窗不是篩選條件變了，不經過這裡；
 * 一行 / 兩列切換時整排換位置，直接到位（measureFit 切換時也會停掉進行中的補間）。
 */
const slides = new Map<HTMLElement, Animation>()
/** DOM 更新前記下的右緣（看得到的位置，含進行中的補間）；null＝這次不做。 */
let slideFrom: Map<HTMLElement, number> | null = null

function cancelSlides(): void {
  for (const a of slides.values()) a.cancel()
  slides.clear()
}

/** 會改變篩選項寬度的篩選條件：下拉標籤、成員頭像、日期膠囊都跟著它們變。 */
const slideSources = [() => filter.filter, () => filter.issueLevels, () => filter.issueStatuses]

watch(
  slideSources,
  () => {
    const box = filtersEl.value
    // jsdom 沒有 Web Animations
    slideFrom =
      box && !stacked.value && typeof box.animate === 'function'
        ? new Map(filterItems(box).map((el) => [el, el.getBoundingClientRect().right]))
        : null
    pillsBefore = box ? snapshotPills(box) : null
  },
  { flush: 'pre' },
)

watch(
  slideSources,
  () => {
    const from = slideFrom
    slideFrom = null
    // 離場的膠囊在 DOM 更新途中（before-leave）已經照它釘好了
    pillsBefore = null
    const box = filtersEl.value
    if (!from || !box) return
    // MutationObserver 觸發的 measureFit 在這之後才跑：先自己量一次，以這次更新完成後的版型為準
    measureFit()
    if (stacked.value) return
    // 進行中的補間先停掉，下面量到的才是版面位置（看得到的舊位置已經記在 from）
    cancelSlides()
    const moves = filterItems(box).map((el) => ({
      el,
      dx: (from.get(el) ?? NaN) - el.getBoundingClientRect().right,
    }))
    const cs = getComputedStyle(document.documentElement)
    const timing = {
      duration: parseDuration(cs.getPropertyValue('--t-panel')),
      easing: cs.getPropertyValue('--ease').trim() || 'ease',
    }
    if (!timing.duration) return
    for (const { el, dx } of moves) {
      // NaN＝新出現的項目；不到半像素＝沒動
      if (!(Math.abs(dx) >= 0.5)) continue
      const anim = el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], timing)
      slides.set(el, anim)
      anim.onfinish = () => {
        if (slides.get(el) === anim) slides.delete(el)
      }
    }
  },
  { flush: 'post' },
)

/**
 * 浮層錨在觸發鈕的哪一側：一行時篩選器靠右排（flex-end），某項變寬是它左緣往左長、右緣不動，錨右緣（end）；
 * 兩列時靠左排，左緣不動，錨左緣（start）。下拉 / 成員面板開著勾選項讓觸發鈕變寬時才不會被帶著跑（G7）。
 * 日曆同一套：一行時基準是篩選器、右緣對齊；兩列時基準換成日期那一組、左緣對齊。
 */
const popAlign = computed<'start' | 'end'>(() => (stacked.value ? 'start' : 'end'))

let fitRaf: number | undefined
/**
 * 視窗以外造成的寬度變化（捲軸出現 / 消失）：下一幀再量。
 * 在 ResizeObserver 回呼裡直接切版型，會讓同一個元素當幀再變尺寸，瀏覽器報 loop 錯誤。
 * 視窗縮放走 resize 事件、當幀就量（在繪製前），不會先畫一幀舊版型。
 */
function measureFitNextFrame(): void {
  if (fitRaf !== undefined) return
  fitRaf = requestAnimationFrame(() => {
    fitRaf = undefined
    measureFit()
  })
}

let fitRo: ResizeObserver | undefined
let fitMo: MutationObserver | undefined
onMounted(() => {
  // 第一次在繪製前就量，畫出來就是對的版型
  measureFit()
  window.addEventListener('resize', measureFit)
  if (typeof ResizeObserver !== 'undefined' && rowEl.value) {
    fitRo = new ResizeObserver(measureFitNextFrame)
    fitRo.observe(rowEl.value)
  }
  // 篩選啟用後下拉的字、日期膠囊會變：DOM 一更新就量（MutationObserver 在繪製前回呼）
  if (filtersEl.value) {
    fitMo = new MutationObserver(measureFit)
    fitMo.observe(filtersEl.value, { childList: true, subtree: true, characterData: true })
  }
  // 網頁字型載入後字寬會變
  document.fonts?.addEventListener('loadingdone', measureFit)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measureFit)
  fitRo?.disconnect()
  fitMo?.disconnect()
  document.fonts?.removeEventListener('loadingdone', measureFit)
  if (fitRaf !== undefined) cancelAnimationFrame(fitRaf)
})

/**
 * 唯讀 tag（F2，decisions Q10）：已載入、而且登入者不是這個專案的 PM 時，專案名旁放灰色「唯讀」，
 * 滑過說明是誰在管。還沒載入時 canEdit 也是 false，所以要先看專案載入了沒（meta.id），載入中才不會閃一下。
 * 顏色照「狀態只用 tag 上色」：只有 tag 本身是灰的，頂欄其他地方不變。
 */
const readonly = computed(() => !!project.meta.id && !project.canEdit)
const readonlyTitle = computed(() => {
  const pm = memberStore.byId(project.meta.pmId)
  return pm ? `此專案由 ${pm.name} 管理` : '此專案由其他 PM 管理'
})
// tag 出現 / 消失會改變標題那一段的寬度，篩選器放不放得下要重量（MutationObserver 只看篩選器裡面）
watch(readonly, () => measureFit(), { flush: 'post' })

/** 面板捷徑；點了捲到該面板。legacy `boardLinks` :3540 + `jumpPanel` :2223 */
const boardLinks = [
  { key: 'gantt', label: '專案時程', icon: '▤' },
  { key: 'kanban', label: '任務', icon: '▦' },
  { key: 'issues', label: 'Issue', icon: '◉' },
] as const

/** 跳到面板時，面板頂端離頂部列下緣的距離（legacy `jumpPanel` 的 `- 12`）。 */
const PANEL_JUMP_GAP = 12

/**
 * 捲到面板，讓面板頂端停在 sticky 頂部列下方 12px（legacy :2223-2227）。
 * 不用 `scrollIntoView({ block: 'start' })`：它把面板頂端對齊視窗頂端，會被 sticky 頂部列蓋住標題列。
 * 面板元素由 `PanelShell` 登錄進 `panels`（契約 F），不再用 `data-panel` 反查。
 * 從總覽切進來時看板 / Issue 可能還沒掛（useDeferredPanels）：先掛上、等 DOM 更新完再量。
 */
async function jumpPanel(key: 'gantt' | 'kanban' | 'issues'): Promise<void> {
  await deferredPanels.ensure()
  const el = registry.panels.get(key)
  if (!el) return
  const top =
    el.getBoundingClientRect().top + window.scrollY - sticky.panelTop.value - PANEL_JUMP_GAP
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

// ── 任務：狀態 / 優先度 / 分類 / Issue 有無 ─────────────────────────────────
const statusKeys = ['todo', 'doing', 'paused', 'done', 'delayed'] as const
const statusOptions = computed<FilterOption[]>(() =>
  statusKeys.map((k) => {
    const st = k === 'delayed' ? DELAYED : TASK_STATUS[k]
    return { key: k, label: st.label, dot: st.dot, checked: filter.statuses.includes(k) }
  }),
)
const prioOptions = computed<FilterOption[]>(() =>
  (['high', 'mid', 'low'] as const).map((k) => ({
    key: k,
    label: PRIORITY[k].label,
    dot: PRIORITY[k].color,
    checked: filter.priorities.includes(k),
  })),
)
const groupOptions = computed<FilterOption[]>(() =>
  taskStore.groups.map((g) => ({
    key: g.id,
    label: g.name,
    checked: filter.groupIds.includes(g.id),
  })),
)
const issueModeOptions = computed<FilterOption[]>(() =>
  [
    { key: 'has', label: '有 Issue' },
    { key: 'none', label: '無 Issue' },
  ].map((o) => ({ ...o, checked: filter.issueMode === o.key })),
)

// ── Issue：等級 / 處理狀態 ─────────────────────────────────────────────────
const levelOptions = computed<FilterOption[]>(() =>
  (['A', 'B', 'C', 'D'] as const).map((k) => ({
    key: k,
    label: ISSUE_LEVEL[k].label,
    dot: ISSUE_LEVEL[k].color,
    checked: filter.issueLevels.includes(k),
  })),
)
const issueStatusOptions = computed<FilterOption[]>(() =>
  (['open', 'doing', 'paused', 'closed', 'delayed'] as const).map((k) => {
    const st = k === 'delayed' ? DELAYED : ISSUE_STATUS[k]
    // 圓點色在 constants 的 ISSUE_STATUS.dot（legacy :3750；review m2）
    const dot = k === 'delayed' ? DELAYED.dot : ISSUE_STATUS[k].dot
    return { key: k, label: st.label, dot, checked: filter.issueStatuses.includes(k) }
  }),
)

// ── 日期模式 ──────────────────────────────────────────────────────────────
const DATE_MODE_LABEL = {
  off: '日期',
  gt: '日期 大於',
  lt: '日期 小於',
  between: '日期 介於',
} as const
const dateModeOptions = computed<FilterOption[]>(() =>
  [
    { key: 'off', label: '不篩選' },
    { key: 'gt', label: '大於' },
    { key: 'lt', label: '小於' },
    { key: 'between', label: '介於' },
  ].map((o) => ({ ...o, checked: filter.dateMode === o.key })),
)

/** 「有 / 無 Issue」是三選一，再點一次同一項回 all。legacy :3727 */
function pickIssueMode(k: string): void {
  filter.issueMode = filter.issueMode === k ? 'all' : (k as 'has' | 'none')
  ui.openDropdown = null
}

function pickDateMode(k: string): void {
  filter.dateMode = k as typeof filter.dateMode
  ui.openDropdown = null
  ui.filterCalendarOpen = k !== 'off'
  filter.calendarTarget = 'd1'
}

/** 點日期膠囊 → 打開日曆並指定要填哪一端。legacy `openCal1` / `openCal2` */
function openCalendar(target: 'd1' | 'd2'): void {
  filter.calendarTarget = target
  ui.filterCalendarOpen = true
  ui.openDropdown = null
  ui.memberPickerOpen = false
}

/**
 * 日期膠囊與「～」淡出時（base.css 的 fade）用 freezeLeave 釘在原位：不佔版面，其他項目立刻排到新位置，
 * G7 的位移補間量得到正確的終點；釘成 absolute 也讓 filterItems 不算它。
 * 定位基準一行時是篩選器、兩列時是日期那一組（.top-row.stacked .date-group），兩者都是 position: relative。
 */
const leavingPills = new Set<HTMLElement>()

interface PillRect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * DOM 更新前日期膠囊 / ～ 看得到的位置（相對各自的定位基準，含進行中的位移補間）。離場時照這份釘，不逐顆現量：
 * 同一次更新裡 Vue 依序呼叫每顆的 before-leave，後面那顆被量到時，前一顆已經釘成 absolute 脫離版面、
 * 「日期」下拉的標籤也已經換字；兩列時日期那一組靠左排，後面的膠囊因此先往左跳再淡出（review）。
 */
let pillsBefore: Map<HTMLElement, PillRect> | null = null

function snapshotPills(box: HTMLElement): Map<HTMLElement, PillRect> {
  const rects = new Map<HTMLElement, PillRect>()
  for (const el of filterItems(box)) {
    if (!el.classList.contains('date-pill') && !el.classList.contains('tilde')) continue
    const t = getComputedStyle(el).transform
    // jsdom 沒有 DOMMatrixReadOnly
    const dx =
      t && t !== 'none' && typeof DOMMatrixReadOnly !== 'undefined'
        ? new DOMMatrixReadOnly(t).m41
        : 0
    rects.set(el, {
      top: el.offsetTop,
      left: el.offsetLeft + dx,
      width: el.offsetWidth,
      height: el.offsetHeight,
    })
  }
  return rects
}

function pinLeaving(el: Element): void {
  const node = el as HTMLElement
  const r = pillsBefore?.get(node)
  // 釘的位置已含位移補間，補間要停掉，不然位移算兩次
  slides.get(node)?.cancel()
  slides.delete(node)
  if (r) {
    node.style.position = 'absolute'
    node.style.top = `${r.top}px`
    node.style.left = `${r.left}px`
    node.style.width = `${r.width}px`
    node.style.height = `${r.height}px`
  } else {
    freezeLeave(el)
  }
  leavingPills.add(node)
}

function unpinLeaving(el: Element): void {
  leavingPills.delete(el as HTMLElement)
}

const showD1 = computed(() => filter.dateMode !== 'off')
const showD2 = computed(() => filter.dateMode === 'between')

/**
 * 清除篩選：日期模式關掉後日曆也要收起來。
 * `filter.clear()` 只動篩選條件，浮層是畫面狀態，由這裡關（契約 E）。legacy :3794
 */
function clearFilters(): void {
  if (!filter.anyFilter) return
  filter.clear()
  ui.filterCalendarOpen = false
}
</script>

<template>
  <header ref="rootEl" class="top-bar">
    <div ref="rowEl" class="top-row" :class="{ stacked }">
      <!-- 左上角三條線：回所有專案總覽 -->
      <RouterLink to="/" class="burger" title="所有專案" aria-label="所有專案">
        <i></i><i></i><i></i>
      </RouterLink>
      <!-- 專案名最多 100 字：放不下時截斷加「…」，滑過看全名 -->
      <h1 class="project" :title="project.meta.name">{{ project.meta.name }}</h1>
      <span v-if="readonly" class="readonly-tag" data-testid="readonly-tag" :title="readonlyTitle"
        >唯讀</span
      >

      <nav class="boards">
        <div
          v-for="b in boardLinks"
          :key="b.key"
          class="board-link"
          role="button"
          @click="jumpPanel(b.key)"
        >
          <span class="board-icon">{{ b.icon }}</span
          ><span>{{ b.label }}</span>
        </div>
      </nav>

      <!-- .fgroup 是「標籤 + 它的下拉」一組：一行時 display: contents（不影響版面），改兩列（.stacked）時整組一起換行 -->
      <div ref="filtersEl" class="filters">
        <span class="fgroup">
          <span class="section">成員</span>
          <MemberPicker :align="popAlign" />
        </span>
        <span class="grow"></span>

        <span class="divider"></span>
        <span class="fgroup">
          <span class="section">任務</span>
          <FilterDropdown
            dd-key="status"
            :align="popAlign"
            :label="filter.statuses.length ? `狀態 ${filter.statuses.length}` : '狀態'"
            :active="filter.statuses.length > 0"
            :options="statusOptions"
            @pick="filter.statuses = toggleIn(filter.statuses, $event as TaskStatus | 'delayed')"
          />
          <FilterDropdown
            dd-key="prio"
            :align="popAlign"
            :label="filter.priorities.length ? `優先度 ${filter.priorities.length}` : '優先度'"
            :active="filter.priorities.length > 0"
            :options="prioOptions"
            @pick="filter.priorities = toggleIn(filter.priorities, $event as Priority)"
          />
          <FilterDropdown
            dd-key="group"
            :align="popAlign"
            :label="filter.groupIds.length ? `分類 ${filter.groupIds.length}` : '分類'"
            :active="filter.groupIds.length > 0"
            :options="groupOptions"
            :menu-width="168"
            :menu-max-height="300"
            ellipsis
            @pick="filter.groupIds = toggleIn(filter.groupIds, $event)"
          />
          <FilterDropdown
            dd-key="issue"
            :align="popAlign"
            :label="{ all: 'Issue', has: '有 Issue', none: '無 Issue' }[filter.issueMode]"
            :active="filter.issueMode !== 'all'"
            :options="issueModeOptions"
            @pick="pickIssueMode"
          />
        </span>

        <span class="divider"></span>
        <span class="fgroup">
          <span class="section">Issue</span>
          <FilterDropdown
            dd-key="icls"
            :align="popAlign"
            :label="filter.issueLevels.length ? `等級 ${filter.issueLevels.length}` : '等級'"
            :active="filter.issueLevels.length > 0"
            :options="levelOptions"
            @pick="filter.issueLevels = toggleIn(filter.issueLevels, $event as IssueLevel)"
          />
          <FilterDropdown
            dd-key="ist"
            :align="popAlign"
            :label="filter.issueStatuses.length ? `狀態 ${filter.issueStatuses.length}` : '狀態'"
            :active="filter.issueStatuses.length > 0"
            :options="issueStatusOptions"
            @pick="
              filter.issueStatuses = toggleIn(
                filter.issueStatuses,
                $event as IssueStatus | 'delayed',
              )
            "
          />
        </span>

        <span class="divider"></span>
        <span class="fgroup date-group">
          <span class="section">日期</span>
          <FilterDropdown
            dd-key="fmode"
            :align="popAlign"
            :label="DATE_MODE_LABEL[filter.dateMode]"
            :active="filter.dateMode !== 'off'"
            :options="dateModeOptions"
            :menu-width="128"
            @pick="pickDateMode"
          />
          <!-- data-keep-popup：日曆開著時點膠囊是切換要填哪一端，不算點到外面（useClickOutside）；
               不用 data-dd：compare.spec 依 [data-dd] 的序列對照 legacy。
               淡入淡出用 base.css 的 fade；離場的釘在原位、不佔版面（pinLeaving） -->
          <Transition name="fade" @before-leave="pinLeaving" @after-leave="unpinLeaving">
            <div
              v-if="showD1"
              class="date-pill"
              data-keep-popup
              role="button"
              @click="openCalendar('d1')"
            >
              {{ fmtDate(filter.d1) }}
            </div>
          </Transition>
          <Transition name="fade" @before-leave="pinLeaving" @after-leave="unpinLeaving">
            <span v-if="showD2" class="tilde">～</span>
          </Transition>
          <Transition name="fade" @before-leave="pinLeaving" @after-leave="unpinLeaving">
            <div
              v-if="showD2"
              class="date-pill"
              data-keep-popup
              role="button"
              @click="openCalendar('d2')"
            >
              {{ fmtDate(filter.d2) }}
            </div>
          </Transition>
          <!-- 日曆的定位基準：一行時 .fgroup 是 display: contents，基準是篩選器、右緣對齊（同 legacy）；
               兩列時基準換成這一組、左緣對齊，篩選器滿寬時才不會離日期膠囊很遠 -->
          <FilterCalendar :align="popAlign" />
        </span>

        <div
          class="clear"
          :class="{ on: filter.anyFilter }"
          data-testid="filter-clear"
          role="button"
          @click="clearFilters()"
        >
          <span class="clear-x">✕</span><span>清除篩選</span>
        </div>
      </div>

      <div class="tail">
        <div
          class="only"
          :class="{ on: filter.onlyFiltered }"
          data-testid="only-filtered"
          role="button"
          @click="filter.onlyFiltered = !filter.onlyFiltered"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" class="eye">
            <ellipse
              cx="12"
              cy="12"
              rx="9.5"
              ry="5.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            <line
              v-if="!filter.onlyFiltered"
              x1="4"
              y1="20"
              x2="20"
              y2="4"
              stroke="currentColor"
              stroke-width="1.8"
            />
          </svg>
          <span>只顯示篩選結果</span>
        </div>
        <div class="me">我</div>
      </div>
    </div>

    <!-- 第二列：寫入失敗的提示條。sticky 高度由 useStickyOffsets 自動吸收（review M11） -->
    <ErrorBar />
  </header>
</template>

<style scoped>
/* 兩列：第一列是原本的頂部列，第二列是 ErrorBar（沒有錯誤時不存在，高度完全相同）。 */
.top-bar {
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-1);
  position: sticky;
  top: 0;
  z-index: 40;
  /* 同 legacy :56，避免 sticky 列在捲動時閃爍 */
  transform: translateZ(0);
  backface-visibility: hidden;
}

.top-row {
  /* 左右留白；兩列時日期日曆也用它算最多能超出日期那一組多少（.date-group 的 --cal-overhang） */
  --top-row-pad-x: var(--sp-10);
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  padding: var(--sp-5) var(--top-row-pad-x);
  flex-wrap: nowrap;
}

/* 回總覽的連結；幾何照原本的 div（compare.spec 比 ±1px），只補掉 a 的預設外觀 */
.burger {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 18px;
  color: inherit;
  text-decoration: none;
}

/* 蓋掉 base.css 的 a:hover（改色 + 底線）；hover 回饋只放在三條線上 */
.burger:hover {
  color: inherit;
  text-decoration: none;
}

.burger:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
  border-radius: var(--r-control);
}

.burger i {
  height: 2px;
  background: var(--text-3);
  border-radius: var(--r-2);
  transition: background var(--t-fast) var(--ease);
}

.burger:hover i {
  background: var(--text-2);
}

/*
 * 專案名（最多 100 字）：再長也只佔約 24 個字寬，窄螢幕再收到視窗寬的 28%，超過就截斷加「…」（title 看全名）。
 * 寬螢幕上篩選器才不會因為名稱長就一定換到第二列（measureFit 量的是截斷後的寬度）；
 * 平板直向兩列時，第一列的「只顯示篩選結果」與頭像也不會被長名稱擠到下一行。
 * 名稱短的時候（範例的 My Project）寬度跟以前寫死時一樣，頂欄版型不變。
 */
.project {
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  letter-spacing: -0.01em;
  flex: 0 0 auto;
  max-width: min(24em, 28vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}

/* 唯讀 tag（F2）：灰色膠囊，只有唯讀時出現；不可點 */
.readonly-tag {
  flex: 0 0 auto;
  padding: var(--pad-pill);
  border: 1px solid var(--border-1);
  border-radius: var(--r-pill);
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  line-height: 1;
  white-space: nowrap;
  cursor: default;
}

.boards {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  padding-left: var(--sp-2);
}

.board-link {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 28px;
  padding: 0 11px;
  font-size: var(--fs-select);
  font-weight: var(--fw-medium);
  border-radius: var(--r-pill);
  color: var(--text-3);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.board-link:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.board-icon {
  font-size: var(--fs-micro);
  opacity: 0.75;
}

.filters {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-3);
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
  overflow: visible;
}

.section {
  font-size: var(--fs-date);
  color: var(--text-muted);
  font-weight: var(--fw-bold);
  letter-spacing: 0.06em;
  flex: 0 0 auto;
}

.grow {
  flex: 1;
}

.fgroup {
  display: contents;
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--border-1);
  flex: 0 0 auto;
}

.date-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 var(--sp-6);
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  background: var(--surface-1);
  border-radius: var(--r-pill);
  color: var(--text-2);
  cursor: pointer;
  font-family: var(--font-mono);
  min-width: 94px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.tilde {
  font-size: var(--fs-meta);
  color: var(--text-muted);
}

.clear {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 0 0 auto;
  height: 30px;
  padding: 0 var(--sp-6);
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  background: var(--surface-1);
  color: var(--text-placeholder);
  border-radius: var(--r-pill);
  cursor: default;
}

/* 有篩選才亮起來、才可點。legacy clearBd / clearBg / clearCursor */
.clear.on {
  border-color: var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger);
  cursor: pointer;
}

.clear-x {
  font-size: var(--fs-pill);
}

.tail {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  flex: 0 0 auto;
}

.only {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 30px;
  padding: 0 var(--sp-6);
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  background: var(--surface-1);
  color: var(--text-muted);
  border-radius: var(--r-pill);
  cursor: pointer;
}

.only.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent-hover);
}

.eye {
  display: block;
}

.me {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--border-control);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-control);
  font-weight: var(--fw-bold);
  color: var(--text-3);
}
/*
 * 篩選器一行放不下（.stacked，由 measureFit 量）：篩選器獨立成滿寬的第二列、靠左排、放不下再換行。
 * 原本擠在標題與右端之間自己換行：平板時被壓成好幾行的窄欄（直向頂欄高到 233px），
 * 1200～1470px（15.6 吋筆電）時兩行亂排、標籤和它的下拉被拆開（user 回報）。legacy 也是這樣，
 * 刻意不跟（README〈刻意保留的差異〉；compare.spec 的位置量測已扣掉頂欄高度）。
 */
.top-row.stacked {
  flex-wrap: wrap;
  row-gap: var(--sp-4);
}

.top-row.stacked .filters {
  order: 3;
  flex: 1 0 100%;
  justify-content: flex-start;
  margin-left: 0;
  gap: var(--sp-3) var(--sp-6);
}

.top-row.stacked .fgroup {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 0 0 auto;
}

/*
 * 日期日曆改以這一組為定位基準（FilterCalendar 收到 align="start"）。
 * 日曆最多可以超出這一組右緣「列的左右留白」那麼多：這一組排在一列最尾、貼著右緣時也不會超出視窗。
 */
.top-row.stacked .date-group {
  position: relative;
  --cal-overhang: var(--top-row-pad-x);
}

/* 換行後分隔線可能落在行首，改由組間距區隔 */
.top-row.stacked .divider {
  display: none;
}

/* 把成員推到最左、其餘推到右邊的彈性空白；換行後會把後面的篩選器擠到下一行 */
.top-row.stacked .grow {
  display: none;
}

.top-row.stacked .tail {
  margin-left: auto;
}

/*
 * measureFit 量的時候：暫時維持單行、不換行、各項不縮、靠左，看篩選器有沒有溢出。
 * 一定要不縮：下拉的中文字可以在任兩字之間斷行，允許縮的話每一項會被擠窄、字折成兩行，量不到溢出。
 * 一定要靠左：平常靠右（flex-end），溢出會往左邊（起始側）長，scrollWidth 不算起始側的溢出。
 */
.top-row.measuring .filters {
  flex-wrap: nowrap;
  justify-content: flex-start;
}

.top-row.measuring .filters > *,
.top-row.measuring .fgroup > * {
  flex-shrink: 0;
}

/* 平板：頂欄間距收小（版型由 .stacked 處理，平板一定放不下一行） */
@media (max-width: 1199px) {
  .top-row {
    --top-row-pad-x: var(--sp-8);
    padding: var(--sp-4) var(--top-row-pad-x);
  }
}

/* 手指操作：☰ 只有 18×12px，用看不見的外擴熱區 */
@media (pointer: coarse) {
  .burger {
    position: relative;
  }

  .burger::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-5)) calc(-1 * var(--sp-4));
  }
}
</style>
