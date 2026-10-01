<script setup lang="ts">
// 頂部固定列：專案名、面板捷徑、成員篩選、七個篩選 pill、日期範圍、清除篩選、只顯示篩選結果。
// legacy 對照：模板 :56-292、各 pill 的 label / options :3657-3764。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import ErrorBar from '@/components/common/ErrorBar.vue'
import FilterCalendar from '@/components/layout/FilterCalendar.vue'
import FilterDropdown, { type FilterOption } from '@/components/layout/FilterDropdown.vue'
import MemberPicker from '@/components/layout/MemberPicker.vue'
import { DELAYED, ISSUE_LEVEL, ISSUE_STATUS, PRIORITY, TASK_STATUS } from '@/constants/dashboard'
import { useDomRegistry } from '@/composables/useDomRegistry'
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'
import { toggleIn } from '@/lib/filter'
import { fmtDate } from '@/lib/format'
import { useFilterStore } from '@/stores/filter'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { IssueLevel, IssueStatus, Priority, TaskStatus } from '@/types/models'

const ui = useUiStore()
const filter = useFilterStore()
const taskStore = useTaskStore()
const sticky = useStickyOffsetsContext()
const registry = useDomRegistry()

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

/** 篩選器裡實際參與排版的項目：`.fgroup` 是 display: contents，算它的子元素；浮在外面的（日曆）不算。 */
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
  const overflow = filterItems(box).some((el) => el.getBoundingClientRect().right > edge + 0.01)
  row.classList.remove('measuring')
  if (stacked.value) row.classList.add('stacked')
  stacked.value = overflow
}

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
 */
function jumpPanel(key: 'gantt' | 'kanban' | 'issues'): void {
  const el = registry.panels.get(key)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - sticky.panelTop.value - PANEL_JUMP_GAP
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
  taskStore.groups.map((g) => ({ key: g.id, label: g.name, checked: filter.groupIds.includes(g.id) })),
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
const DATE_MODE_LABEL = { off: '日期', gt: '日期 大於', lt: '日期 小於', between: '日期 介於' } as const
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
      <h1 class="project">My Project</h1>

      <nav class="boards">
        <div
          v-for="b in boardLinks"
          :key="b.key"
          class="board-link"
          role="button"
          @click="jumpPanel(b.key)"
        >
          <span class="board-icon">{{ b.icon }}</span><span>{{ b.label }}</span>
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
              filter.issueStatuses = toggleIn(filter.issueStatuses, $event as IssueStatus | 'delayed')
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
               不用 data-dd：compare.spec 依 [data-dd] 的序列對照 legacy -->
          <div
            v-if="showD1"
            class="date-pill"
            data-keep-popup
            role="button"
            @click="openCalendar('d1')"
          >
            {{ fmtDate(filter.d1) }}
          </div>
          <span v-if="showD2" class="tilde">～</span>
          <div
            v-if="showD2"
            class="date-pill"
            data-keep-popup
            role="button"
            @click="openCalendar('d2')"
          >
            {{ fmtDate(filter.d2) }}
          </div>
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

.project {
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  letter-spacing: -0.01em;
  flex: 0 0 auto;
  white-space: nowrap;
  margin: 0;
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
