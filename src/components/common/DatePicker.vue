<script setup lang="ts">
// 兩個浮動日期選擇器：任務的起訖日期（含工期輸入）與 Issue / 任務的單一日期。
// legacy 對照：模板 :1325-1390，dCalCells :3452-3486、iCalCells :3488-3509。
import { computed } from 'vue'
import { monthGrid, WEEK_LABELS, type CalendarCell } from '@/lib/calendar'
import { dayIndex, isoFromIndex, lengthOf, shiftMonth } from '@/lib/date'
import { fmtDate } from '@/lib/format'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 工期輸入框的上限。legacy `dCalSetDays` :4003 */
const MAX_DAYS = 3650

const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()

/** 42 格由 `monthGrid` 產（契約 D），這裡只疊上這個選擇器自己的展示狀態。 */
type Cell = CalendarCell & {
  /** 不是本月：字色轉淡。 */
  dim: boolean
  /** 起訖之間（不含端點）。 */
  inRange: boolean
  /** 端點 / 目前選到的日期。 */
  picked: boolean
}

function monthTitle(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`
}

// ── 任務起訖日期選擇器（legacy dCal）────────────────────────────────────────
const dCal = computed(() => ui.taskDatePicker)
const dTask = computed(() => (dCal.value ? taskStore.taskById(dCal.value.id) : undefined))

const dCells = computed<Cell[]>(() => {
  const cal = dCal.value
  const t = dTask.value
  if (!cal || !t) return []
  const sIdx = dayIndex(t.start)
  const eIdx = dayIndex(t.end)
  return monthGrid(cal.month, ui.todayIdx).map((c) => ({
    ...c,
    dim: !c.inMonth,
    inRange: c.idx > sIdx && c.idx < eIdx,
    picked: c.idx === sIdx || c.idx === eIdx,
  }))
})

function dShift(n: number): void {
  const cal = ui.taskDatePicker
  if (cal) cal.month = shiftMonth(cal.month, n)
}

function dToday(): void {
  const cal = ui.taskDatePicker
  if (cal) cal.month = ui.todayIso.slice(0, 7)
}

/**
 * 選一天：目前在填 start 就整段平移（保工期），在填 end 時若點到 start 之前則對調。
 * 選完自動把填寫目標換到另一端。legacy :3470-3482
 */
function dPick(cell: Cell): void {
  const cal = ui.taskDatePicker
  const t = dTask.value
  if (!cal || !t) return
  const sIdx = dayIndex(t.start)
  const dur = dayIndex(t.end) - sIdx
  const wasStart = cal.target === 'start'
  cal.month = cell.iso.slice(0, 7)
  cal.target = wasStart ? 'end' : 'start'
  if (wasStart) taskStore.updateTask(t.id, { start: cell.iso, end: isoFromIndex(cell.idx + dur) })
  else if (cell.idx < sIdx) taskStore.updateTask(t.id, { start: cell.iso, end: t.start })
  else taskStore.updateTask(t.id, { end: cell.iso })
}

/** 直接輸入工期天數；沿用 legacy 的逐鍵寫入（:4000）。 */
function dSetDays(e: Event): void {
  const t = dTask.value
  if (!t) return
  const n = parseInt((e.target as HTMLInputElement).value, 10)
  if (!Number.isFinite(n) || n < 1) return
  taskStore.updateTask(t.id, { end: isoFromIndex(dayIndex(t.start) + Math.min(n, MAX_DAYS) - 1) })
}

// ── 單一日期選擇器（legacy iCal；kind='task' 時改任務完成日）────────────────
const iCal = computed(() => ui.issueDatePicker)

/** 目前這個欄位的值；任務模式讀 task.done，Issue 模式讀 issue 的 due / done。 */
const iValue = computed<string>(() => {
  const cal = iCal.value
  if (!cal) return ''
  if (cal.kind === 'task') return taskStore.taskById(cal.id)?.done ?? ''
  const issue = issueStore.byId(cal.id)
  return (issue ? issue[cal.field] : '') || ''
})

const iExists = computed(
  () => !!iCal.value && !!(iCal.value.kind === 'task' ? taskStore.taskById(iCal.value.id) : issueStore.byId(iCal.value.id)),
)

const iCells = computed<Cell[]>(() => {
  const cal = iCal.value
  if (!cal || !iExists.value) return []
  const cur = iValue.value ? dayIndex(iValue.value) : null
  return monthGrid(cal.month, ui.todayIdx).map((c) => ({
    ...c,
    dim: !c.inMonth,
    inRange: false,
    picked: cur !== null && c.idx === cur,
  }))
})

function iShift(n: number): void {
  const cal = ui.issueDatePicker
  if (cal) cal.month = shiftMonth(cal.month, n)
}

function iToday(): void {
  const cal = ui.issueDatePicker
  if (cal) cal.month = ui.todayIso.slice(0, 7)
}

/** 寫值；任務模式走 setTaskDoneDirect（不牽動排程，legacy iCalSet :3491）。 */
function iSet(iso: string): void {
  const cal = ui.issueDatePicker
  if (!cal) return
  if (cal.kind === 'task') taskStore.setTaskDoneDirect(cal.id, iso)
  else issueStore.updateIssue(cal.id, cal.field === 'due' ? { due: iso } : { done: iso })
  ui.issueDatePicker = null
}
</script>

<template>
  <!-- 遮罩不掛 data-dd，維持 legacy 行為（:1323 / :1348） -->
  <template v-if="dCal && dTask">
    <div class="cal-mask" @click="ui.taskDatePicker = null"></div>
    <div
      class="cal task-date-picker"
      :style="{ left: `${dCal.left}px`, top: `${dCal.top}px` }"
    >
      <div class="cal-head">
        <div class="cal-name" :title="dTask.name">{{ dTask.name }}</div>
        <div class="cal-days">
          <input
            type="number"
            data-dur
            min="1"
            :max="MAX_DAYS"
            :value="lengthOf(dTask)"
            @click.stop
            @input="dSetDays"
          />
          <span class="cal-days-unit">天</span>
        </div>
      </div>
      <div class="cal-ends">
        <div
          class="cal-end"
          :class="{ aimed: dCal.target === 'start' }"
          role="button"
          @click="dCal.target = 'start'"
        >
          {{ fmtDate(dTask.start) }}
        </div>
        <div
          class="cal-end"
          :class="{ aimed: dCal.target === 'end' }"
          role="button"
          @click="dCal.target = 'end'"
        >
          {{ fmtDate(dTask.end) }}
        </div>
      </div>
      <div class="cal-bar">
        <div class="cal-title">{{ monthTitle(dCal.month) }}</div>
        <div class="cal-nav" role="button" @click="dToday()">今天</div>
        <div class="cal-arrow" role="button" @click="dShift(-1)">‹</div>
        <div class="cal-arrow" role="button" @click="dShift(1)">›</div>
      </div>
      <div class="cal-grid">
        <div v-for="w in WEEK_LABELS" :key="w" class="cal-weekday">{{ w }}</div>
      </div>
      <div class="cal-grid">
        <div
          v-for="c in dCells"
          :key="c.idx"
          class="cal-cell"
          :class="{ dim: c.dim, range: c.inRange, today: c.isToday, picked: c.picked }"
          role="button"
          @click="dPick(c)"
        >
          {{ c.label }}
        </div>
      </div>
    </div>
  </template>

  <template v-if="iCal && iExists">
    <div class="cal-mask" @click="ui.issueDatePicker = null"></div>
    <div
      class="cal issue-date-picker"
      :style="{ left: `${iCal.left}px`, top: `${iCal.top}px` }"
    >
      <div class="cal-head">
        <div class="cal-name">{{ iCal.field === 'due' ? '期限' : '實際完成日期' }}</div>
        <div class="cal-clear" role="button" @click="iSet('')">清除</div>
      </div>
      <div class="cal-value">{{ fmtDate(iValue) }}</div>
      <div class="cal-bar">
        <div class="cal-title">{{ monthTitle(iCal.month) }}</div>
        <div class="cal-nav" role="button" @click="iToday()">今天</div>
        <div class="cal-arrow" role="button" @click="iShift(-1)">‹</div>
        <div class="cal-arrow" role="button" @click="iShift(1)">›</div>
      </div>
      <div class="cal-grid">
        <div v-for="w in WEEK_LABELS" :key="w" class="cal-weekday">{{ w }}</div>
      </div>
      <div class="cal-grid">
        <div
          v-for="c in iCells"
          :key="c.idx"
          class="cal-cell"
          :class="{ dim: c.dim, today: c.isToday, picked: c.picked }"
          role="button"
          @click="iSet(c.iso)"
        >
          {{ c.label }}
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.cal-mask {
  position: fixed;
  inset: 0;
  z-index: 190;
}

.cal {
  position: fixed;
  z-index: 200;
  width: 250px;
  padding: var(--sp-6);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-popover);
  animation: popIn var(--t-pop) ease-out;
}

.cal-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-5);
}

.cal-name {
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--text-2);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cal-days {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  flex: 0 0 auto;
}

.cal-days input {
  width: 46px;
  padding: var(--sp-1) var(--r-badge);
  font-size: var(--fs-date);
  font-family: var(--font-mono);
  color: var(--text-2);
  text-align: right;
  border: 1px solid var(--border-1);
  border-radius: var(--r-6);
  background: var(--surface-2);
}

/* 表單 focus 與 legacy 一致：藍框、無 outline（:1332） */
.cal-days input:focus {
  border-color: var(--accent);
  background: var(--surface-1);
  outline: none;
}

.cal-days-unit {
  font-size: var(--fs-date);
  color: var(--text-muted);
}

.cal-clear {
  font-size: var(--fs-pill);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--r-2) var(--sp-3);
  border-radius: var(--r-badge);
}

.cal-clear:hover {
  color: var(--danger-text);
  background: var(--danger-bg);
}

.cal-value {
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-6);
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  border-radius: var(--r-control);
  color: var(--text-2);
  background: var(--surface-2);
  text-align: center;
  font-family: var(--font-mono);
}

.cal-ends {
  display: flex;
  gap: var(--sp-4);
  margin-bottom: var(--sp-6);
}

.cal-end {
  flex: 1;
  min-width: 0;
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  border-radius: var(--r-control);
  color: var(--text-muted);
  background: var(--surface-2);
  text-align: center;
  cursor: pointer;
  font-family: var(--font-mono);
}

.cal-end.aimed {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.cal-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}

.cal-title {
  font-size: var(--fs-month);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  flex: 1;
}

.cal-nav {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--sp-1) 7px;
  border-radius: var(--r-badge);
}

.cal-arrow {
  font-size: var(--fs-month);
  color: var(--text-muted);
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-badge);
}

.cal-nav:hover,
.cal-arrow:hover {
  color: var(--text-1);
  background: var(--surface-3);
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--r-2);
}

.cal-weekday {
  height: var(--sp-12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-meta);
  color: var(--text-muted);
}

.cal-cell {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-control);
  border-radius: var(--r-control);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-family: var(--font-mono);
  font-weight: var(--fw-regular);
}

.cal-cell:hover {
  filter: var(--hover-dim);
}

.cal-cell.dim {
  color: var(--glyph-disabled);
}

/* 覆蓋順序 = legacy 的三個 if 順序：區間 → 今天 → 端點（:3466-3469） */
.cal-cell.range {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent-hover);
}

.cal-cell.today {
  background: var(--today);
  color: var(--surface-1);
  font-weight: var(--fw-bold);
  border-radius: var(--r-day);
}

.cal-cell.picked {
  background: var(--accent);
  color: var(--surface-1);
  font-weight: var(--fw-bold);
  border-radius: var(--r-day);
}
</style>
