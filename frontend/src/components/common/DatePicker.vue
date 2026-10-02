<script setup lang="ts">
// 兩個浮動日期選擇器：任務的起訖日期（含工期輸入）與 Issue / 任務的單一日期。
// 工期是工作天；選了不會生效的日子依排程規則停用，原因寫成看得見的一行；非工作天上底色、底部列出本月假日
// （規則見 docs/reference/scheduling.md）。
// legacy 對照：模板 :1325-1390，dCalCells :3452-3486、iCalCells :3488-3509。
import { computed, ref } from 'vue'
import { useCloseOnScroll } from '@/composables/useCloseOnScroll'
import { menuAnchors } from '@/composables/useMenus'
import {
  EDIT_BLOCK_TEXT,
  MONTH_HOLIDAYS_TEXT,
  OVERDUE_SHRINK_TEXT,
  PICK_LIMIT_TEXT,
} from '@/constants/dashboard'
import { monthGrid, WEEK_LABELS, type CalendarCell } from '@/lib/calendar'
import { dayIndex, shiftMonth } from '@/lib/date'
import { fmtDate, WORKDAY_UNIT } from '@/lib/format'
import { DURATION_MAX, durationBlock, durationOf, isOverdue, startBlock } from '@/lib/schedule'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { Task } from '@/types/models'

const clock = useClockStore()
const ui = useUiStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()
const calendar = useWorkCalendarStore()

/** 42 格由 `monthGrid` 產（契約 D），這裡只疊上這個選擇器自己的展示狀態。 */
type Cell = CalendarCell & {
  /** 不是本月：字色轉淡。 */
  dim: boolean
  /** 起訖之間（不含端點）。 */
  inRange: boolean
  /** 端點 / 目前選到的日期。 */
  picked: boolean
  /** 非工作天（週末、放假日）：上底色；補班日是工作天，不上。 */
  off: boolean
  /** 假日（或補班）的名稱，放格子的 title；普通日子是 ''。 */
  name: string
  /** 選了不會生效（依排程規則）：停用，點了不動作。 */
  disabled: boolean
}

function monthTitle(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`
}

/** 一格的工作日曆資訊：是不是非工作天、假日名稱。 */
function workdayOf(c: CalendarCell): Pick<Cell, 'off' | 'name'> {
  const wd = calendar.workdays
  return { off: !wd.isWorkday(c.idx), name: wd.nameOf(c.idx) }
}

/** 底部那一行：這個月的假日（「M/D 名稱」以頓號連接）；沒有假日回 ''。 */
function monthHolidays(cells: Cell[]): string {
  const list = cells
    .filter((c) => c.inMonth && c.off && c.name)
    .map((c) => `${Number(c.iso.slice(5, 7))}/${c.label} ${c.name}`)
  return list.length ? MONTH_HOLIDAYS_TEXT(list.join('、')) : ''
}

/** 工期夾在 1–DURATION_MAX（工作天）。 */
function clampDays(n: number): number {
  return Math.min(DURATION_MAX, Math.max(1, n))
}

// ── 任務起訖日期選擇器（legacy dCal）────────────────────────────────────────
const dCal = computed(() => ui.taskDatePicker)
/** 推算後的任務（畫面看的起訖）。 */
const dTask = computed(() => (dCal.value ? taskStore.taskById(dCal.value.id) : undefined))
const dCalEl = ref<HTMLElement | null>(null)

/** 開始日能不能改：有前置、未開始的不能（開始日由前置決定）。 */
const dStartBlock = computed(() =>
  dTask.value ? startBlock(dTask.value, taskStore.hasPred) : null,
)
/** 工期 / 結束日能不能改：已完成的不能（結束日就是完成日）。 */
const dDurationBlock = computed(() => (dTask.value ? durationBlock(dTask.value) : null))
/** 逾期未完成：結束日暫定今天，選今天以前當結束日不會生效。 */
const dOverdue = computed(
  () => !!dTask.value && isOverdue(dTask.value, calendar.workdays, clock.todayIdx),
)
/** 工期欄顯示的有效工期（工作天）。 */
const dDays = computed(() => (dTask.value ? durationOf(dTask.value, calendar.workdays) : 0))

/**
 * 這一格當成目前填的那一端，會不會被排程規則吃掉（規則見 docs/reference/scheduling.md）：
 * - 填開始日：進行中 / 暫停的不晚於今天；已完成的不晚於完成日。
 * - 填結束日：開始日不能改時，不能點在開始日之前（沒辦法對調）；逾期時結束日最早是今天。
 */
function dDisabled(idx: number, t: Task, target: 'start' | 'end'): boolean {
  if (target === 'start') {
    if (t.status === 'doing' || t.status === 'paused') return idx > clock.todayIdx
    if (t.status === 'done' && t.done) return idx > dayIndex(t.done)
    return false
  }
  if (dStartBlock.value && idx < dayIndex(t.start)) return true
  return dOverdue.value && idx < clock.todayIdx
}

/** 說明行：為什麼有東西停用（看得見的一行，觸控看不到 title）；沒有限制時是 ''。 */
const dNote = computed(() => {
  const t = dTask.value
  const cal = dCal.value
  if (!t || !cal) return ''
  const block = dStartBlock.value ?? dDurationBlock.value
  if (block) return EDIT_BLOCK_TEXT[block]
  if (cal.target === 'start' && (t.status === 'doing' || t.status === 'paused'))
    return PICK_LIMIT_TEXT.startAfterToday
  if (cal.target === 'end' && dOverdue.value) return OVERDUE_SHRINK_TEXT
  return ''
})

// 觸發元素被捲走就關（位置只在開啟時量一次）；焦點在工期輸入框時不關
useCloseOnScroll({
  state: dCal,
  popover: dCalEl,
  anchor: () => menuAnchors.taskDate,
  close: () => {
    ui.taskDatePicker = null
  },
})

const dCells = computed<Cell[]>(() => {
  const cal = dCal.value
  const t = dTask.value
  if (!cal || !t) return []
  const sIdx = dayIndex(t.start)
  const eIdx = dayIndex(t.end)
  return monthGrid(cal.month, clock.todayIdx).map((c) => ({
    ...c,
    ...workdayOf(c),
    dim: !c.inMonth,
    inRange: c.idx > sIdx && c.idx < eIdx,
    picked: c.idx === sIdx || c.idx === eIdx,
    disabled: dDisabled(c.idx, t, cal.target),
  }))
})

const dHolidays = computed(() => monthHolidays(dCells.value))

function dShift(n: number): void {
  const cal = ui.taskDatePicker
  if (cal) cal.month = shiftMonth(cal.month, n)
}

function dToday(): void {
  const cal = ui.taskDatePicker
  if (cal) cal.month = clock.todayIso.slice(0, 7)
}

/** 換填寫目標（點起訖膠囊）；那一端不能改時不換。 */
function dAim(target: 'start' | 'end'): void {
  const cal = ui.taskDatePicker
  if (!cal || (target === 'start' ? dStartBlock.value : dDurationBlock.value)) return
  cal.target = target
}

/**
 * 選一天（規則見 docs/reference/scheduling.md）。legacy :3470-3482
 * - 填開始日：只送開始日；工期不變，結束日由工期推算（等於整段平移）。
 * - 填結束日：換算成工期（開始日到那天的工作天數）；點在開始日之前、而且開始日能改時，起訖對調。
 * 選完換填另一端；另一端不能改時留在原處。停用的格子不動作。
 */
function dPick(cell: Cell): void {
  const cal = ui.taskDatePicker
  const t = dTask.value
  if (!cal || !t || cell.disabled) return
  const wd = calendar.workdays
  const sIdx = dayIndex(t.start)
  const wasStart = cal.target === 'start'
  cal.month = cell.iso.slice(0, 7)
  if (wasStart) {
    if (!dDurationBlock.value) cal.target = 'end'
    taskStore.updateTask(t.id, { start: cell.iso })
    return
  }
  if (!dStartBlock.value) cal.target = 'start'
  if (cell.idx < sIdx)
    taskStore.updateTask(t.id, {
      start: cell.iso,
      duration: clampDays(wd.countWorkdays(cell.idx, sIdx)),
    })
  else taskStore.updateTask(t.id, { duration: clampDays(wd.countWorkdays(sIdx, cell.idx)) })
}

/** 直接輸入工期（工作天）；沿用 legacy 的逐鍵寫入（:4000），超過上限夾在 DURATION_MAX。已完成的唯讀。 */
function dSetDays(e: Event): void {
  const t = dTask.value
  if (!t || dDurationBlock.value) return
  const n = parseInt((e.target as HTMLInputElement).value, 10)
  if (!Number.isFinite(n) || n < 1) return
  taskStore.updateTask(t.id, { duration: Math.min(n, DURATION_MAX) })
}

// ── 單一日期選擇器（legacy iCal；kind='task' 時改任務完成日）────────────────
const iCal = computed(() => ui.issueDatePicker)
const iCalEl = ref<HTMLElement | null>(null)

useCloseOnScroll({
  state: () => ui.issueDatePicker,
  popover: iCalEl,
  anchor: () => menuAnchors.issueDate,
  close: () => {
    ui.issueDatePicker = null
  },
})

/** 任務模式時的任務（推算後）：完成日不能早於它的開始日。 */
const iTask = computed(() =>
  iCal.value?.kind === 'task' ? taskStore.taskById(iCal.value.id) : undefined,
)

/** 目前這個欄位的值；任務模式讀 task.done，Issue 模式讀 issue 的 due / done。 */
const iValue = computed<string>(() => {
  const cal = iCal.value
  if (!cal) return ''
  if (cal.kind === 'task') return iTask.value?.done ?? ''
  const issue = issueStore.byId(cal.id)
  return (issue ? issue[cal.field] : '') || ''
})

const iExists = computed(
  () =>
    !!iCal.value && !!(iCal.value.kind === 'task' ? iTask.value : issueStore.byId(iCal.value.id)),
)

const iCells = computed<Cell[]>(() => {
  const cal = iCal.value
  if (!cal || !iExists.value) return []
  const cur = iValue.value ? dayIndex(iValue.value) : null
  // 任務模式：完成日不能早於開始日（規則見 docs/reference/scheduling.md）
  const minIdx = iTask.value ? dayIndex(iTask.value.start) : -Infinity
  return monthGrid(cal.month, clock.todayIdx).map((c) => ({
    ...c,
    ...workdayOf(c),
    dim: !c.inMonth,
    inRange: false,
    picked: cur !== null && c.idx === cur,
    disabled: c.idx < minIdx,
  }))
})

const iHolidays = computed(() => monthHolidays(iCells.value))
/**
 * 已完成任務的完成日不能清掉：結束日就是完成日，清掉會變成「完成卻沒有完成日」
 * （規則見 docs/reference/scheduling.md〈不會生效的輸入不寫進資料〉；store 也會擋）。
 */
const iClearBlocked = computed(() => iTask.value?.status === 'done')
/** 說明行：任務模式寫出完成日的下限；已完成時再寫「清除」為什麼不能用。 */
const iNotes = computed(() =>
  !iTask.value
    ? []
    : iClearBlocked.value
      ? [PICK_LIMIT_TEXT.doneBeforeStart, PICK_LIMIT_TEXT.doneRequired]
      : [PICK_LIMIT_TEXT.doneBeforeStart],
)

function iShift(n: number): void {
  const cal = ui.issueDatePicker
  if (cal) cal.month = shiftMonth(cal.month, n)
}

function iToday(): void {
  const cal = ui.issueDatePicker
  if (cal) cal.month = clock.todayIso.slice(0, 7)
}

/**
 * 寫值。任務模式改的是完成日（`setTaskDoneDirect`）：已完成任務的結束日就是完成日，
 * 會推動未開始的下游（規則見 docs/reference/scheduling.md）。legacy iCalSet :3491
 */
function iSet(iso: string): void {
  const cal = ui.issueDatePicker
  if (!cal) return
  if (cal.kind === 'task') taskStore.setTaskDoneDirect(cal.id, iso)
  else issueStore.updateIssue(cal.id, cal.field === 'due' ? { due: iso } : { done: iso })
  ui.issueDatePicker = null
}

/** 點一格；停用的格子（任務模式下早於開始日）不動作。 */
function iPick(cell: Cell): void {
  if (!cell.disabled) iSet(cell.iso)
}
</script>

<template>
  <!-- 遮罩不掛 data-dd，維持 legacy 行為（:1323 / :1348）。
       選擇器本體的進出場用 base.css 的 pop；遮罩不包，關閉當下就放行點擊 -->
  <div v-if="dCal && dTask" class="cal-mask" @click="ui.taskDatePicker = null"></div>
  <Transition name="pop">
    <div
      v-if="dCal && dTask"
      ref="dCalEl"
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
            :max="DURATION_MAX"
            :value="dDays"
            :readonly="!!dDurationBlock"
            @click.stop
            @input="dSetDays"
          />
          <span class="cal-days-unit">{{ WORKDAY_UNIT }}</span>
        </div>
      </div>
      <div class="cal-ends">
        <div
          class="cal-end"
          :class="{ aimed: dCal.target === 'start', disabled: !!dStartBlock }"
          role="button"
          :aria-disabled="dStartBlock ? 'true' : undefined"
          @click="dAim('start')"
        >
          {{ fmtDate(dTask.start) }}
        </div>
        <div
          class="cal-end"
          :class="{ aimed: dCal.target === 'end', disabled: !!dDurationBlock }"
          role="button"
          :aria-disabled="dDurationBlock ? 'true' : undefined"
          @click="dAim('end')"
        >
          {{ fmtDate(dTask.end) }}
        </div>
      </div>
      <div v-if="dNote" class="cal-note">{{ dNote }}</div>
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
          :class="{
            off: c.off,
            disabled: c.disabled,
            dim: c.dim,
            range: c.inRange,
            today: c.isToday,
            picked: c.picked,
          }"
          :data-date="c.iso"
          :title="c.name || undefined"
          role="button"
          :aria-disabled="c.disabled ? 'true' : undefined"
          @click="dPick(c)"
        >
          {{ c.label }}
        </div>
      </div>
      <div v-if="dHolidays" class="cal-holidays">{{ dHolidays }}</div>
    </div>
  </Transition>

  <div v-if="iCal && iExists" class="cal-mask" @click="ui.issueDatePicker = null"></div>
  <Transition name="pop">
    <div
      v-if="iCal && iExists"
      ref="iCalEl"
      class="cal issue-date-picker"
      :style="{ left: `${iCal.left}px`, top: `${iCal.top}px` }"
    >
      <div class="cal-head">
        <div class="cal-name">{{ iCal.field === 'due' ? '期限' : '實際完成日期' }}</div>
        <div
          class="cal-clear"
          :class="{ disabled: iClearBlocked }"
          role="button"
          :aria-disabled="iClearBlocked"
          :title="iClearBlocked ? PICK_LIMIT_TEXT.doneRequired : undefined"
          @click="!iClearBlocked && iSet('')"
        >
          清除
        </div>
      </div>
      <div class="cal-value">{{ fmtDate(iValue) }}</div>
      <div v-for="n in iNotes" :key="n" class="cal-note">{{ n }}</div>
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
          :class="{
            off: c.off,
            disabled: c.disabled,
            dim: c.dim,
            today: c.isToday,
            picked: c.picked,
          }"
          :data-date="c.iso"
          :title="c.name || undefined"
          role="button"
          :aria-disabled="c.disabled ? 'true' : undefined"
          @click="iPick(c)"
        >
          {{ c.label }}
        </div>
      </div>
      <div v-if="iHolidays" class="cal-holidays">{{ iHolidays }}</div>
    </div>
  </Transition>
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

/* 唯讀（已完成的任務不能改工期）：focus 不換底色、不亮框，同其他唯讀輸入框 */
.cal-days input[readonly]:focus {
  border-color: var(--border-1);
  background: var(--surface-2);
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

.cal-clear:not(.disabled):hover {
  color: var(--danger-text);
  background: var(--danger-bg);
}

/* 停用（已完成任務的完成日）：沿用其他停用的寫法——字轉淡、游標不變、沒有 hover */
.cal-clear.disabled {
  color: var(--text-placeholder);
  cursor: default;
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

/* 不能改的一端（開始日由前置決定、已完成的結束日）：沿用 :disabled 的寫法——字轉淡、游標不變 */
.cal-end.disabled {
  color: var(--text-placeholder);
  cursor: default;
}

/* 停用原因、本月假日：看得見的一行說明（觸控看不到 title） */
.cal-note,
.cal-holidays {
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--text-muted);
}

/* 緊貼在起訖膠囊下面（.cal-ends 的下距是 --sp-6，這裡收回一半） */
.cal-note {
  margin: calc(-1 * var(--sp-3)) 0 var(--sp-5);
}

.cal-holidays {
  margin-top: var(--sp-4);
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

/* 非工作天（週末、放假日）：同甘特圖背景的底色；補班日是工作天，不上 */
.cal-cell.off {
  background: var(--bg-weekend);
}

/* 停用：選了不會生效的日子（依排程規則）；沿用 :disabled 的寫法。放在 .dim 前面，前後月份的灰字照舊 */
.cal-cell.disabled {
  color: var(--text-placeholder);
  cursor: default;
}

.cal-cell.disabled:hover {
  filter: none;
}

.cal-cell.dim {
  color: var(--glyph-disabled);
}

/* 覆蓋順序 = legacy 的三個 if 順序：區間 → 今天 → 端點（:3466-3469） */
.cal-cell.range {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent-hover);
}

/* 區間裡的非工作天：區間色疊在週末底色上，看得出哪幾天不算工期 */
.cal-cell.range.off {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-weekend));
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

/* 今天這格停用時（例：對準結束日、今天早於開始日）整格轉淡，不然實心底色看起來像能點 */
.cal-cell.today.disabled {
  opacity: 0.45;
}
</style>
