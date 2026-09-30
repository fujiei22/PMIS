<script setup lang="ts">
// 專案時程面板：尺規、左欄任務 / 分類列、右側甘特條與相依線。
// legacy 對照：模板 :387-531，days / months :2716-2733，stripes :2882，sticky :3634-3637。
import { computed, ref, watch } from 'vue'
import PanelShell from '@/components/common/PanelShell.vue'
import DependencyLines from '@/components/gantt/DependencyLines.vue'
import GanttBars from '@/components/gantt/GanttBars.vue'
import GanttGroupRow from '@/components/gantt/GanttGroupRow.vue'
import GanttTaskRow from '@/components/gantt/GanttTaskRow.vue'
import GanttTimeline, { type RulerDay, type RulerMonth } from '@/components/gantt/GanttTimeline.vue'
import { registerEl, useDomRegistry } from '@/composables/useDomRegistry'
import { useFocusRequest } from '@/composables/useFocusScroll'
import { useGanttScroll } from '@/composables/useGanttScroll'
import { NARROW_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { usePointerDrag } from '@/composables/usePointerDrag'
import { useRowMotion } from '@/composables/useRowMotion'
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'
import { useTaskActions } from '@/composables/useTaskActions'
import { ROW_HEIGHT } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { useClockStore } from '@/stores/clock'
import { useFilterStore } from '@/stores/filter'
import { useRowsStore } from '@/stores/rows'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { Group, Task } from '@/types/models'

/** 一天的毫秒數；把日索引換回 Date 用。 */
const DAY_MS = 86_400_000
/** chart 最低高度，任務很少時也不會塌掉。legacy :2714 */
const MIN_CHART_H = 120
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

const clock = useClockStore()
const ui = useUiStore()
const actions = useTaskActions()
const rowsStore = useRowsStore()
const taskStore = useTaskStore()
const filter = useFilterStore()
const selection = useSelectionStore()
const sticky = useStickyOffsetsContext()
const registry = useDomRegistry()

const scrollerEl = ref<HTMLElement | null>(null)
const rulerEl = ref<HTMLElement | null>(null)
const chartEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
// scrollX / viewW 由 composable 繼續維護，S5 的拖曳要用；S3 的畫面本身用不到
const { onScroll, jumpToday, onZoom, scrollTo } = useGanttScroll(scrollerEl, rulerEl)

// 拖曳的容器在這一層，API 往下 provide 給列與條（GanttGroupRow / GanttTaskRow / GanttBars）
const drag = usePointerDrag({ gantt: scrollerEl, chart: chartEl, vscroll: bodyEl })

/** 選到任務就把它的條捲到畫面左側三分之一處。legacy `focus()` :2400-2403 */
useFocusRequest((req) => {
  const t = taskStore.taskById(req.taskId)
  const sc = scrollerEl.value
  if (!t || !sc) return
  const left = (dayIndex(t.start) - taskStore.range.a) * ui.dayWidth
  scrollTo(Math.max(0, left - sc.clientWidth / 3), true)
})

const rows = computed(() => rowsStore.visibleRows)

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
      today: idx === clock.todayIdx,
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
    related: v.kind === 't' && (!!selection.related[v.id] || !!selection.softHighlight[v.id]),
  })),
)

/** 橫紋的元素（key 同 stripes 的 key），列位移補間要寫到它們身上。 */
const stripeEls = new Map<string, HTMLElement>()

/**
 * 某一列（`g-<gid>` / `t-<tid>`）在畫面上的元素：左欄列、橫紋、條（收合分類是摘要條）、條兩側的連線圓點。
 * 同一列的元素由 useRowMotion 寫同一個位移，左右才會一起走。
 */
function* rowElements(key: string): Generator<HTMLElement | undefined> {
  const id = key.slice(2)
  yield stripeEls.get(key)
  if (key.startsWith('g-')) {
    yield registry.groups.get(id)
    yield registry.bars.get(`sum-${id}`)
  } else {
    yield registry.rows.get(id)
    yield registry.bars.get(id)
    const dots = registry.linkDots.get(id)
    yield dots?.L
    yield dots?.R
  }
}

// 收合 / 篩選 / 重排時列的上下位移（左欄與右側同一個時鐘，取代 TransitionGroup 的 move 與條的 top 過渡）
useRowMotion({
  keys: () => rows.value.map((v) => `${v.kind}-${v.id}`),
  elementsOf: rowElements,
  rowHeight: ROW_HEIGHT,
})

const zoomPct = computed(() => Math.round((ui.dayWidth / 32) * 100))
/** 滑桿軌道左半段的填色比例。legacy `zoomFill` :3581 */
const zoomFill = computed(() => Math.round(((ui.dayWidth - 14) / 18) * 100))
const allCollapsed = computed(() => taskStore.groups.every((g) => ui.collapsedGroups.has(g.id)))

/** 平板直向：左欄是只寫工期的窄版，欄頭右端多一顆展開鈕切回完整左欄（桌機左欄一直是完整的，不需要）。 */
const narrow = useMediaQuery(NARROW_QUERY)

/*
 * 左欄的寬度（ganttLeftExpanded）與列的寫法（ganttLeftDates）同時切：
 * 膠囊換寫法時由 GanttTaskRow 把膠囊寬度從舊寫法補間到新寫法，時長與曲線跟左欄寬度（--t-layout / --ease）一樣，
 * 任務名的寬度就一路單調（動畫稽核 D15）。原本「展開時等寬度撐開才換成起訖日」會讓任務名先變寬、
 * 換寫法那一幀又縮回 105px；膠囊在補間途中裁掉超出的字，不會蓋住任務名。
 */
watch(
  () => ui.ganttLeftExpanded,
  (on) => {
    ui.ganttLeftDates = on
  },
  { immediate: true },
)

/**
 * 全部收合 / 全部展開。legacy `toggleAllGroups` :4110。
 * 分類清單在資料層，收合狀態在 ui——由這裡把 id 交給 ui（契約 E）。
 */
function toggleAllGroups(): void {
  ui.setAllCollapsed(allCollapsed.value ? [] : taskStore.groups.map((g) => g.id))
}
</script>

<template>
  <PanelShell panel="gantt" :class="{ 'left-expanded': ui.ganttLeftExpanded }">
    <template #head>
      <h2 class="panel-title">專案時程</h2>
      <!-- 計數字樣在 filterStore，與看板共用一份（legacy :3532；review m4） -->
      <div class="panel-count" data-testid="task-count">{{ filter.taskCountLabel }}</div>
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
        <span class="left-title">任務 / 分類</span>
        <span class="spacer"></span>
        <span class="head-actions">
          <button class="mini" @click="toggleAllGroups()">
            <!-- 只有文字、不加箭頭符號（legacy `allGroupsCaret` :4106） -->
            {{ allCollapsed ? '全部展開' : '全部收合' }}
          </button>
          <button class="mini" @click="taskStore.addGroup()">＋ 分類</button>
          <button class="mini" @click="actions.addTaskWithDefaults()">＋ 任務</button>
        </span>
        <!--
          窄版左欄的展開鈕：放在欄頭右端、貼著要展開的那條邊，» 朝右＝往右展開，展開後轉成 « 朝左＝收回。
          在欄頭裡照一般排版順序排（不跨在分隔線上），不會疊到尺規。點了只改怎麼看，不清選取。
        -->
        <button
          v-if="narrow"
          type="button"
          class="mini left-toggle"
          data-testid="gantt-left-toggle"
          data-keep-selection
          :aria-expanded="ui.ganttLeftExpanded"
          :aria-label="ui.ganttLeftExpanded ? '收合左欄' : '展開左欄，顯示起訖日'"
          :title="ui.ganttLeftExpanded ? '收合左欄' : '展開左欄，顯示起訖日'"
          @click="ui.ganttLeftExpanded = !ui.ganttLeftExpanded"
        >
          <svg class="left-toggle-icon" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.5 2.5 6 6 2.5 9.5M6.5 2.5 10 6 6.5 9.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <div ref="rulerEl" class="gantt-ruler">
        <GanttTimeline :days="days" :months="months" :chart-width="chartWidth" />
      </div>
    </div>

    <div ref="bodyEl" class="gantt-body">
      <div class="gantt-rows">
        <!-- 左欄：平鋪 visibleRows；收合 / 重排的上下位移由 useRowMotion 補間，離場列直接移除（同 legacy） -->
        <div class="gantt-left">
          <div class="gantt-flow">
            <template v-for="v in leftRows" :key="v.key">
              <GanttGroupRow v-if="v.group" :group="v.group" />
              <GanttTaskRow v-else-if="v.task" :task="v.task" />
            </template>
          </div>
          <div class="gantt-filler"></div>
        </div>

        <!-- 右側：可水平捲動的畫布 -->
        <div ref="scrollerEl" class="gantt-scroller" @scroll="onScroll">
          <div
            ref="chartEl"
            class="gantt-chart"
            :class="{ panning: ui.drag?.kind === 'pan' }"
            :style="{ width: `${chartWidth}px`, height: `${chartHeight}px` }"
            @pointerdown="drag.startPan($event)"
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
              :ref="registerEl(stripeEls, s.key)"
              class="stripe"
              :class="{ group: s.group, selected: s.selected, related: s.related }"
              :style="{ top: `${s.top}px`, width: `${chartWidth}px` }"
            ></div>
            <DependencyLines :chart-width="chartWidth" :chart-height="chartHeight" />
            <GanttBars :chart-height="chartHeight" />
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

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會黏著，展開鈕按完會一直是灰底 */
@media (hover: hover) {
  .mini:hover {
    background: var(--surface-3);
    border-color: var(--text-placeholder);
    color: var(--text-1);
  }
}

/* 左欄展開鈕：和欄頭按鈕同一套外框的正方形；單一圖示旋轉表示方向（同其他收合箭頭，A24） */
.mini.left-toggle {
  justify-content: center;
  flex: 0 0 auto;
  width: var(--sp-12);
  padding: 0;
}

.left-toggle-icon {
  width: var(--sp-6);
  height: var(--sp-6);
  transition: transform var(--t-layout) var(--ease);
}

.left-expanded .left-toggle-icon {
  transform: rotate(180deg);
}

/* 手指操作：按鈕只有 24px，熱區上下撐到 36px（左右不外擴，免得蓋到隔壁的「＋ 任務」） */
@media (pointer: coarse) {
  .left-toggle {
    position: relative;
  }

  .left-toggle::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--sp-3)) 0;
  }
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

/* 平移中：整個畫布的游標換成抓握（body 也同步改，指標跑到畫布外也不會變回來） */
.gantt-chart.panning {
  cursor: grabbing;
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
  /* 上下位移不走 top 過渡：由 useRowMotion 寫 translate，跟左欄列同一個時鐘 */
  transition: background var(--t-base) ease;
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

/*
 * 平板直向（< 900px）：左欄 366px 會吃掉一半寬度，時間軸只剩兩週左右。
 * 改 250px；列內日期膠囊只寫工期（GanttTaskRow 的 slim）。欄頭右端的展開鈕（.left-expanded）切回完整寬度，寬度變化有過渡。
 */
@media (max-width: 899px) {
  .gantt-left-head,
  .gantt-left {
    width: 250px;
    flex-basis: 250px;
    transition:
      width var(--t-layout) var(--ease),
      flex-basis var(--t-layout) var(--ease);
  }

  .left-expanded .gantt-left-head,
  .left-expanded .gantt-left {
    width: var(--gantt-left);
    flex-basis: var(--gantt-left);
  }

  /* 250px 的欄頭要多放一顆展開鈕：內距、間距與三顆按鈕的左右內距各收一點；標題自己吃剩下的空間，不另放 spacer */
  .gantt-left-head {
    gap: var(--sp-3);
    padding: 0 var(--sp-3) 0 var(--sp-4);
  }

  .gantt-left-head .spacer {
    display: none;
  }

  .mini {
    padding: 0 var(--sp-3);
  }

  /*
   * 標題：收合時沒有位置（寬度被擠到 0、透明），展開時淡入。
   * 不換行、放不下就裁掉：寬度過渡的途中空間還不夠，允許換行的話漢字會被擠成一字一行、把欄頭撐亂。
   */
  .left-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    opacity: 0;
    transition: opacity var(--t-layout) var(--ease);
  }

  .left-expanded .left-title {
    opacity: 1;
  }
}
</style>
