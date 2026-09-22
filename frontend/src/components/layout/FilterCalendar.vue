<script setup lang="ts">
// 頂部列的日期篩選日曆（大於 / 小於 / 介於三種模式共用）。
// legacy 對照：模板 :249-277、calCells :3249-3276。
import { computed } from 'vue'
import { monthGrid, WEEK_LABELS, type CalendarCell } from '@/lib/calendar'
import { dayIndex, shiftMonth } from '@/lib/date'
import { fmtDate } from '@/lib/format'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useUiStore } from '@/stores/ui'

const clock = useClockStore()
const ui = useUiStore()
const filter = useFilterStore()

const showD2 = computed(() => filter.dateMode === 'between')

/** 目前顯示的月份：使用者翻過就用 calendarMonth，否則跟著 d1，再不然是今天。legacy :3242 */
const anchor = computed(() => filter.calendarMonth || (filter.d1 || clock.todayIso).slice(0, 7))
const title = computed(() => `${Number(anchor.value.slice(0, 4))}年${Number(anchor.value.slice(5, 7))}月`)

/** 42 格由 `monthGrid` 產（契約 D），這裡只疊端點 / 區間 / 今天的顯示狀態。 */
type Cell = CalendarCell & {
  /** 不是本月：字色轉淡。 */
  dim: boolean
  /** 是 d1 或 d2 的端點。 */
  end: boolean
  /** 介於模式的區間內（不含端點）。 */
  inRange: boolean
  /** 端點的樣式蓋過今天，所以今天要先排除端點。legacy :3273 */
  today: boolean
}

const cells = computed<Cell[]>(() => {
  const a = filter.d1 && filter.d2 ? Math.min(dayIndex(filter.d1), dayIndex(filter.d2)) : null
  const b = filter.d1 && filter.d2 ? Math.max(dayIndex(filter.d1), dayIndex(filter.d2)) : null
  return monthGrid(anchor.value, clock.todayIdx).map((c) => {
    const end = c.iso === filter.d1 || c.iso === filter.d2
    return {
      ...c,
      dim: !c.inMonth,
      end,
      inRange: filter.dateMode === 'between' && a != null && c.idx > a && c.idx < b!,
      today: c.isToday && !end,
    }
  })
})

function shift(n: number): void {
  filter.calendarMonth = shiftMonth(anchor.value, n)
}

function goToday(): void {
  filter.calendarMonth = clock.todayIso.slice(0, 7)
}

function aim(target: 'd1' | 'd2'): void {
  filter.calendarTarget = target
}

/** 填 d1 / d2；填 d1 後在「介於」模式自動換填 d2。legacy :3267-3274 */
function pick(iso: string): void {
  const idx = dayIndex(iso)
  if (filter.calendarTarget === 'd1') {
    if (filter.dateMode === 'between' && filter.d2 && dayIndex(filter.d2) < idx) filter.d2 = ''
    filter.d1 = iso
    filter.calendarTarget = filter.dateMode === 'between' ? 'd2' : 'd1'
    if (filter.dateMode !== 'between') ui.filterCalendarOpen = false
  } else if (filter.d1 && dayIndex(filter.d1) > idx) {
    filter.d2 = filter.d1
    filter.d1 = iso
    ui.filterCalendarOpen = false
  } else {
    filter.d2 = iso
    ui.filterCalendarOpen = false
  }
  filter.calendarMonth = iso.slice(0, 7)
}
</script>

<template>
  <div v-if="ui.filterCalendarOpen" class="cal-mask" @click="ui.filterCalendarOpen = false"></div>
  <div v-if="ui.filterCalendarOpen" class="cal" data-dd="1">
    <div class="cal-ends">
      <div
        class="cal-end"
        :class="{ aimed: filter.calendarTarget === 'd1' }"
        role="button"
        @click="aim('d1')"
      >
        {{ fmtDate(filter.d1) }}
      </div>
      <div
        v-if="showD2"
        class="cal-end"
        :class="{ aimed: filter.calendarTarget === 'd2' }"
        role="button"
        @click="aim('d2')"
      >
        {{ fmtDate(filter.d2) }}
      </div>
    </div>
    <div class="cal-bar">
      <div class="cal-title">{{ title }}</div>
      <div class="cal-nav" role="button" @click="goToday">今天</div>
      <div class="cal-arrow" role="button" @click="shift(-1)">‹</div>
      <div class="cal-arrow" role="button" @click="shift(1)">›</div>
    </div>
    <div class="cal-grid">
      <div v-for="w in WEEK_LABELS" :key="w" class="cal-weekday">{{ w }}</div>
    </div>
    <div class="cal-grid">
      <div
        v-for="c in cells"
        :key="c.iso"
        class="cal-cell"
        :class="{ dim: c.dim, end: c.end, range: c.inRange, today: c.today }"
        role="button"
        @click="pick(c.iso)"
      >
        {{ c.label }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.cal {
  position: absolute;
  top: 42px;
  right: 0;
  z-index: 100;
  width: 250px;
  padding: var(--sp-6);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-popover);
  animation: popIn var(--t-pop) ease-out;
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
  color: var(--text-2);
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

.cal-cell.dim {
  color: var(--glyph-disabled);
}

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

.cal-cell.end {
  background: var(--accent);
  color: var(--surface-1);
  font-weight: var(--fw-bold);
  border-radius: var(--r-day);
}
</style>
