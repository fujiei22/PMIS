<script setup lang="ts">
// 專案時程面板：尺規、左欄任務 / 分類列、右側甘特條與相依線。
// legacy 對照：模板 :387-531，days / months :2716-2733，stripes :2882，sticky :3634-3637。
import { computed, ref } from 'vue'
import PanelShell from '@/components/common/PanelShell.vue'
import DependencyLines from '@/components/gantt/DependencyLines.vue'
import GanttBars from '@/components/gantt/GanttBars.vue'
import GanttGroupRow from '@/components/gantt/GanttGroupRow.vue'
import GanttTaskRow from '@/components/gantt/GanttTaskRow.vue'
import GanttTimeline, { type RulerDay, type RulerMonth } from '@/components/gantt/GanttTimeline.vue'
import { useFocusRequest } from '@/composables/useFocusScroll'
import { useGanttScroll } from '@/composables/useGanttScroll'
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { useFilterStore } from '@/stores/filter'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Group, Task } from '@/types/models'

/** 一天的毫秒數；把日索引換回 Date 用。 */
const DAY_MS = 86_400_000
/** chart 最低高度，任務很少時也不會塌掉。legacy :2714 */
const MIN_CHART_H = 120
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

const ui = useUiStore()
const taskStore = useTaskStore()
const filter = useFilterStore()
const selection = useSelectionStore()
const sticky = useStickyOffsetsContext()

const scrollerEl = ref<HTMLElement | null>(null)
const rulerEl = ref<HTMLElement | null>(null)
// scrollX / viewW 由 composable 繼續維護，S5 的拖曳要用；S3 的畫面本身用不到
const { onScroll, jumpToday, onZoom, scrollTo } = useGanttScroll(scrollerEl, rulerEl)

/** 選到任務就把它的條捲到畫面左側三分之一處。legacy `focus()` :2400-2403 */
useFocusRequest((req) => {
  const t = taskStore.taskById(req.taskId)
  const sc = scrollerEl.value
  if (!t || !sc) return
  const left = (dayIndex(t.start) - taskStore.range.a) * ui.dayWidth
  scrollTo(Math.max(0, left - sc.clientWidth / 3), true)
})

const rows = computed(() => taskStore.visibleRows)

/** 左欄要畫的列，先把 id 解成實體，template 就不必用非空斷言。 */
interface LeftRow {
  key: string
  group?: Group
  task?: Task
}

const leftRows = computed<LeftRow[]>(() =>
  rows.value.flatMap<LeftRow>((v) => {
    if (v.kind === 'g') {
      const group = taskStore.groupById(v.id)
      return group ? [{ key: `g-${v.id}`, group }] : []
    }
    const task = taskStore.taskById(v.id)
    return task ? [{ key: `t-${v.id}`, task }] : []
  }),
)

const totalDays = computed(() => taskStore.range.b - taskStore.range.a)
const chartWidth = computed(() => totalDays.value * ui.dayWidth)
const chartHeight = computed(() => Math.max(rows.value.length * ROW_HEIGHT, MIN_CHART_H))

/** 尺規與 chart 背景共用的每日資料。legacy :2718-2733 */
const days = computed<RulerDay[]>(() => {
  const out: RulerDay[] = []
  for (let i = 0; i < totalDays.value; i++) {
    const idx = taskStore.range.a + i
    const d = new Date(idx * DAY_MS)
    const wd = d.getUTCDay()
    out.push({
      idx,
      left: i * ui.dayWidth,
      w: ui.dayWidth,
      dd: String(d.getUTCDate()).padStart(2, '0'),
      wd: WEEKDAY[wd]!,
      weekend: wd === 0 || wd === 6,
      today: idx === ui.todayIdx,
    })
  }
  return out
})

/** 把連續同月的日子併成一格；太窄就只留月份或不顯示。legacy :2728-2732 */
const months = computed<RulerMonth[]>(() => {
  const out: RulerMonth[] = []
  for (const d of days.value) {
    const dt = new Date(d.idx * DAY_MS)
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    const last = out[out.length - 1]
    if (last && last.label === key) last.w += ui.dayWidth
    else out.push({ label: key, w: ui.dayWidth, short: '' })
    const cur = out[out.length - 1]!
    cur.short = cur.w >= 62 ? cur.label : cur.w >= 26 ? cur.label.slice(5) : ''
  }
  return out
})

/** 每一列在 chart 上的底色橫紋。legacy `stripes` :2882 */
const stripes = computed(() =>
  rows.value.map((v, i) => ({
    key: `${v.kind}-${v.id}`,
    top: i * ROW_HEIGHT,
    group: v.kind === 'g',
    selected: v.kind === 't' && selection.taskId === v.id,
    related:
      v.kind === 't' && (!!selection.related[v.id] || !!selection.softHighlight[v.id]),
  })),
)

/** 「共 N 個任務」／「已篩選 N/M 個任務」。legacy `taskCountLabel` :3532 */
const taskCountLabel = computed(() => {
  const all = taskStore.tasks
  const matched = all.filter((t) => filter.matchTask(t)).length
  return matched === all.length
    ? `共 ${all.length} 個任務`
    : `已篩選 ${matched}/${all.length} 個任務`
})

const zoomPct = computed(() => Math.round((ui.dayWidth / 32) * 100))
/** 滑桿軌道左半段的填色比例。legacy `zoomFill` :3581 */
const zoomFill = computed(() => Math.round(((ui.dayWidth - 14) / 18) * 100))
const allCollapsed = computed(() => taskStore.groups.every((g) => g.collapsed))
</script>

<template>
  <PanelShell panel="gantt">
    <template #head>
      <h2 class="panel-title">專案時程</h2>
      <div class="panel-count" data-testid="task-count">{{ taskCountLabel }}</div>
      <div class="spacer"></div>
      <div class="zoom">
        <input
          type="range"
          data-zoom="1"
          min="14"
          max="32"
          step="0.25"
          :value="ui.dayWidth"
          :style="{
            background: `linear-gradient(90deg, var(--accent) ${zoomFill}%, var(--border-1) ${zoomFill}%)`,
          }"
          @input="onZoom(($event.target as HTMLInputElement).value)"
          @change="onZoom(($event.target as HTMLInputElement).value)"
        />
        <span class="zoom-pct">{{ zoomPct }}%</span>
      </div>
      <button class="today-btn" @click="jumpToday(true)">今天</button>
    </template>

    <!-- sticky 尺規：左欄標題 + 月 / 日刻度 -->
    <div class="gantt-ruler-row" :style="{ top: `${sticky.innerTop('gantt')}px` }">
      <div class="gantt-left-head">
        任務 / 分類
        <span class="spacer"></span>
        <span class="head-actions">
          <button class="mini" @click="taskStore.setAllCollapsed(!allCollapsed)">
            {{ allCollapsed ? '▶ 全部展開' : '▼ 全部收合' }}
          </button>
          <button class="mini" @click="taskStore.addGroup()">＋ 分類</button>
          <button class="mini" @click="taskStore.addTask()">＋ 任務</button>
        </span>
      </div>
      <div ref="rulerEl" class="gantt-ruler">
        <GanttTimeline :days="days" :months="months" :chart-width="chartWidth" />
      </div>
    </div>

    <div class="gantt-body">
      <div class="gantt-rows">
        <!-- 左欄：平鋪 visibleRows，TransitionGroup 負責收合 / 重排的 FLIP -->
        <div class="gantt-left">
          <TransitionGroup tag="div" move-class="row-move" class="gantt-flow">
            <template v-for="v in leftRows" :key="v.key">
              <GanttGroupRow v-if="v.group" :group="v.group" />
              <GanttTaskRow v-else-if="v.task" :task="v.task" />
            </template>
          </TransitionGroup>
          <div class="gantt-filler"></div>
        </div>

        <!-- 右側：可水平捲動的畫布 -->
        <div ref="scrollerEl" class="gantt-scroller" @scroll="onScroll">
          <div
            class="gantt-chart"
            :style="{ width: `${chartWidth}px`, height: `${chartHeight}px` }"
          >
            <div
              v-for="d in days"
              :key="d.idx"
              class="day-bg"
              :class="{ weekend: d.weekend, today: d.today }"
              :style="{ left: `${d.left}px`, width: `${d.w}px` }"
            ></div>
            <div
              v-for="s in stripes"
              :key="s.key"
              class="stripe"
              :class="{ group: s.group, selected: s.selected, related: s.related }"
              :style="{ top: `${s.top}px`, width: `${chartWidth}px` }"
            ></div>
            <DependencyLines :chart-width="chartWidth" :chart-height="chartHeight" />
            <GanttBars />
          </div>
        </div>
      </div>
    </div>
  </PanelShell>
</template>

<style scoped>
.panel-title {
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
  margin: 0;
}

.panel-count {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.spacer {
  flex: 1;
}

.zoom {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  height: var(--sp-12);
  flex: 0 0 auto;
}

.zoom input {
  width: 112px;
}

.zoom-pct {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
  width: 40px;
  text-align: right;
}

.today-btn {
  height: var(--sp-12);
  padding: 0 var(--sp-5);
  border: 1px solid var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--r-control);
  cursor: pointer;
  font-size: var(--fs-meta);
  font-weight: var(--fw-medium);
  line-height: 1;
}

.gantt-ruler-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border-1);
  background: var(--surface-2);
  position: sticky;
  z-index: 26;
  transform: translateZ(0);
  backface-visibility: hidden;
}

.gantt-left-head {
  width: var(--gantt-left);
  flex: 0 0 var(--gantt-left);
  height: var(--gantt-head);
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: 0 var(--sp-5) 0 var(--sp-6);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--text-muted);
  letter-spacing: 0.04em;
  border-right: 1px solid var(--border-1);
  background: var(--surface-2);
  position: relative;
  z-index: 2;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 0 0 auto;
}

.mini {
  height: var(--sp-12);
  padding: 0 var(--sp-5);
  display: flex;
  align-items: center;
  font-size: var(--fs-meta);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  border-radius: var(--r-control);
  cursor: pointer;
  color: var(--text-2);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  transition:
    background var(--t-fast) ease,
    border-color var(--t-fast) ease,
    color var(--t-fast) ease;
}

.mini:hover {
  background: var(--surface-3);
  border-color: var(--text-placeholder);
  color: var(--text-1);
}

.gantt-ruler {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  height: var(--gantt-head);
}

.gantt-body {
  position: relative;
  overflow: hidden;
  border-radius: 0 0 var(--r-panel) var(--r-panel);
}

.gantt-rows {
  display: flex;
  align-items: stretch;
}

.gantt-left {
  width: var(--gantt-left);
  flex: 0 0 var(--gantt-left);
  background: var(--surface-1);
  border-right: 1px solid var(--border-1);
  box-shadow: var(--shadow-left-col);
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
}

.gantt-flow {
  display: flex;
  flex-direction: column;
}

.gantt-filler {
  flex: 1;
  min-height: 0;
}

/* 收合 / 重排時列的位移由 TransitionGroup 的 FLIP 處理 */
.row-move {
  transition: transform var(--t-fast) var(--ease);
}

.gantt-scroller {
  position: relative;
  z-index: 1;
  isolation: isolate;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.gantt-chart {
  position: relative;
  cursor: grab;
}

.day-bg {
  position: absolute;
  top: 0;
  height: 100%;
  background: transparent;
  border-right: 1px solid var(--border-hair);
}

.day-bg.weekend {
  background: var(--bg-weekend);
}

/* 今天的底色壓過週末（legacy :2723 的三元順序） */
.day-bg.today {
  background: var(--bg-today);
}

.stripe {
  position: absolute;
  left: 0;
  height: var(--gantt-row);
  background: transparent;
  border-bottom: 1px solid var(--border-hair);
  transition:
    top var(--t-bar) var(--ease),
    background var(--t-base) ease;
}

.stripe.group {
  background: var(--surface-group);
}

.stripe.related {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.stripe.selected {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
</style>
