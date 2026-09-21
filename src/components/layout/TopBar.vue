<script setup lang="ts">
// 頂部固定列：專案名、面板捷徑、成員篩選、七個篩選 pill、日期範圍、清除篩選、只顯示篩選結果。
// legacy 對照：模板 :56-292、各 pill 的 label / options :3657-3764。
import { computed, ref, watch } from 'vue'
import ErrorBar from '@/components/common/ErrorBar.vue'
import FilterCalendar from '@/components/layout/FilterCalendar.vue'
import FilterDropdown, { type FilterOption } from '@/components/layout/FilterDropdown.vue'
import MemberPicker from '@/components/layout/MemberPicker.vue'
import { DELAYED, ISSUE_LEVEL, ISSUE_STATUS, PRIORITY, TASK_STATUS } from '@/constants/dashboard'
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'
import { fmtDate } from '@/lib/format'
import { useFilterStore } from '@/stores/filter'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { IssueLevel, IssueStatus, Priority, TaskStatus } from '@/types/models'

const ui = useUiStore()
const filter = useFilterStore()
const taskStore = useTaskStore()
const sticky = useStickyOffsetsContext()

const rootEl = ref<HTMLElement | null>(null)
watch(rootEl, (el) => sticky.observe('top', el), { immediate: true })

/** 面板捷徑；點了捲到該面板。legacy `boardLinks` :3540 + `jumpPanel` :2223 */
const boardLinks = [
  { key: 'gantt', label: '專案時程', icon: '▤' },
  { key: 'kanban', label: '任務', icon: '▦' },
  { key: 'issues', label: 'Issue', icon: '◉' },
] as const

function jumpPanel(key: string): void {
  document.querySelector(`[data-panel="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 多選欄位的共用切換。 */
function toggleIn<T extends string>(list: T[], key: T): T[] {
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key]
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
    <div class="top-row">
      <div class="burger"><i></i><i></i><i></i></div>
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

      <div class="filters">
        <span class="section">成員</span>
        <MemberPicker />
        <span class="grow"></span>

        <span class="divider"></span>
        <span class="section">任務</span>
        <FilterDropdown
          dd-key="status"
          :label="filter.statuses.length ? `狀態 ${filter.statuses.length}` : '狀態'"
          :active="filter.statuses.length > 0"
          :options="statusOptions"
          @pick="filter.statuses = toggleIn(filter.statuses, $event as TaskStatus | 'delayed')"
        />
        <FilterDropdown
          dd-key="prio"
          :label="filter.priorities.length ? `優先度 ${filter.priorities.length}` : '優先度'"
          :active="filter.priorities.length > 0"
          :options="prioOptions"
          @pick="filter.priorities = toggleIn(filter.priorities, $event as Priority)"
        />
        <FilterDropdown
          dd-key="group"
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
          :label="{ all: 'Issue', has: '有 Issue', none: '無 Issue' }[filter.issueMode]"
          :active="filter.issueMode !== 'all'"
          :options="issueModeOptions"
          @pick="pickIssueMode"
        />

        <span class="divider"></span>
        <span class="section">Issue</span>
        <FilterDropdown
          dd-key="icls"
          :label="filter.issueLevels.length ? `等級 ${filter.issueLevels.length}` : '等級'"
          :active="filter.issueLevels.length > 0"
          :options="levelOptions"
          @pick="filter.issueLevels = toggleIn(filter.issueLevels, $event as IssueLevel)"
        />
        <FilterDropdown
          dd-key="ist"
          :label="filter.issueStatuses.length ? `狀態 ${filter.issueStatuses.length}` : '狀態'"
          :active="filter.issueStatuses.length > 0"
          :options="issueStatusOptions"
          @pick="
            filter.issueStatuses = toggleIn(filter.issueStatuses, $event as IssueStatus | 'delayed')
          "
        />

        <span class="divider"></span>
        <span class="section">日期</span>
        <FilterDropdown
          dd-key="fmode"
          :label="DATE_MODE_LABEL[filter.dateMode]"
          :active="filter.dateMode !== 'off'"
          :options="dateModeOptions"
          :menu-width="128"
          @pick="pickDateMode"
        />
        <div v-if="showD1" class="date-pill" role="button" @click="openCalendar('d1')">
          {{ fmtDate(filter.d1) }}
        </div>
        <span v-if="showD2" class="tilde">～</span>
        <div v-if="showD2" class="date-pill" role="button" @click="openCalendar('d2')">
          {{ fmtDate(filter.d2) }}
        </div>

        <div
          class="clear"
          :class="{ on: filter.anyFilter }"
          data-testid="filter-clear"
          role="button"
          @click="clearFilters()"
        >
          <span class="clear-x">✕</span><span>清除篩選</span>
        </div>

        <FilterCalendar />
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
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  padding: var(--sp-5) var(--sp-10);
  flex-wrap: nowrap;
}

.burger {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 18px;
}

.burger i {
  height: 2px;
  background: var(--text-3);
  border-radius: var(--r-2);
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
</style>
