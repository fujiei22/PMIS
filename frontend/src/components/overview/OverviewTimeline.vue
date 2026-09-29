<script setup lang="ts">
// 時間軸檢視：面板外殼 + sticky 尺規（月份 / 週刻度）+ 可橫捲的畫布（週一分隔線、今天底色、今天線、PM 群組）。
// 左欄與畫布放在同一個水平捲動容器裡（左欄 sticky left），速覽才能緊接在選取列下方、橫跨左欄 + 畫布。
// 容器自己的橫捲軸藏起來，底下另放一條只在畫布下方的捲軸；左欄不會橫捲，捲軸不該伸到它下面。
// 畫布區也能按住拖曳左右平移（useDragPan）。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import OvEmpty from '@/components/overview/OvEmpty.vue'
import OvPanel from '@/components/overview/OvPanel.vue'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import TimelineGroup from '@/components/overview/TimelineGroup.vue'
import { freezeLeave } from '@/composables/freezeLeave'
import { useDragPan } from '@/composables/useDragPan'
import { NARROW_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { TIMELINE_DAY_W, TIMELINE_LEFT_W, TIMELINE_LEFT_W_NARROW } from '@/constants/overview'
import { dayFraction } from '@/lib/date'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()
const clock = useClockStore()

const DW = TIMELINE_DAY_W

const range = computed(() => overview.range)
const groups = computed(() => overview.groups)

/** 刻度與底層共用的日清單；d 是相對範圍起點的偏移，idx 是絕對日索引。 */
const days = computed(() =>
  range.value.dayList.map((x) => ({
    ...x,
    d: x.idx - range.value.startIdx,
    dnum: String(x.date).padStart(2, '0'),
    isToday: x.idx === clock.todayIdx,
  })),
)
/**
 * 一天只有約 7px 寬，逐日寫不下：尺規只在週一寫日期，畫布也不畫週末灰底（灰條只會變成條碼，B2 1956 / 2053）。
 * 所以尺規只要週一那幾天，畫布底層只要週一分隔線與今天底色那幾天。
 */
const weekTicks = computed(() => days.value.filter((x) => x.isMonday))
const bgDays = computed(() => days.value.filter((x) => x.isMonday || x.isToday))

/** 範圍一定涵蓋今天所在的月份（timelineRange），今天線與「今天」按鈕不必再判斷在不在範圍內。 */
const todayOffset = computed(() => clock.todayIdx - range.value.startIdx)
/** 今天線的 x（相對畫布起點）：整數日 + 當天已過的工作時間比例，公式同 GanttBars。 */
const todayX = computed(() => (todayOffset.value + dayFraction(new Date(clock.now))) * DW)

const viewW = ref(0)

/** 左欄寬；窄版的欄位縮減在 TimelineProjectRow 與下方尺規的 CSS（同一個 899px 門檻）。 */
const narrow = useMediaQuery(NARROW_QUERY)
const leftW = computed(() => (narrow.value ? TIMELINE_LEFT_W_NARROW : TIMELINE_LEFT_W))

const rootStyle = computed(() => ({
  '--gantt-left': `${leftW.value}px`,
  '--dw': `${DW}px`,
  '--tl-days': String(range.value.days),
  '--view-w': viewW.value ? `${viewW.value}px` : undefined,
}))

const body = ref<HTMLElement | null>(null)
const ruler = ref<HTMLElement | null>(null)
const hbar = ref<HTMLElement | null>(null)
const pan = useDragPan(body)
/** 上次由容器同步給捲軸的位置；捲軸因此發出的 scroll 事件是回音，要略過。 */
let barEcho = -1

/** 尺規與底下的捲軸都在捲動容器外（尺規要 sticky top），所以手動同步水平位置。 */
function onBodyScroll(): void {
  if (!body.value) return
  const left = body.value.scrollLeft
  if (ruler.value) ruler.value.scrollLeft = left
  if (hbar.value) {
    hbar.value.scrollLeft = left
    barEcho = hbar.value.scrollLeft
  }
}

/**
 * 拖底下的捲軸時帶動捲動容器。
 * 回音一定要略過：「今天」按鈕平滑捲動途中，回寫 scrollLeft 會打斷容器的平滑捲動。
 */
function onBarScroll(): void {
  if (!hbar.value || !body.value) return
  if (Math.abs(hbar.value.scrollLeft - barEcho) < 1) return
  body.value.scrollLeft = hbar.value.scrollLeft
}

/** 把今天置中到畫布可見區（扣掉左欄）；smooth 給按鈕（A14），auto 給初次掛載。 */
function scrollToToday(behavior: ScrollBehavior): void {
  const el = body.value
  if (!el) return
  const left = Math.max(0, todayX.value - (el.clientWidth - leftW.value) / 2)
  el.scrollTo({ left, behavior })
}

function measure(): void {
  if (body.value) viewW.value = body.value.clientWidth
}

let ro: ResizeObserver | undefined

/**
 * 捲動容器會重建（面板收合後再展開、空狀態切回來），每次拿到新的元素就重新觀察寬度並捲到今天。
 * 新元素的 scrollLeft 一定是 0，停在範圍起點沒意義，所以不只第一次。
 */
watch(
  body,
  (el) => {
    ro?.disconnect()
    ro = undefined
    if (!el) return
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      ro.observe(el)
    }
    scrollToToday('auto')
  },
  { flush: 'post' },
)

onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <OvPanel title="專案時程" view="timeline" :style="rootStyle">
    <template #head>
      <OvSortControls />
    </template>
    <template #head-extra>
      <button
        type="button"
        class="today-btn"
        data-testid="overview-today"
        @click="scrollToToday('smooth')"
      >
        今天
      </button>
    </template>

    <Transition name="ov-fade" mode="out-in">
      <OvEmpty v-if="!groups.length" key="empty" class="tl-empty" />
      <div v-else key="timeline" class="tl">
        <!-- sticky 尺規：左欄標題 + 月份列 / 週刻度；在 isolated 的 .tl-chart 之外，速覽才蓋不到它 -->
        <div class="tl-ruler-row">
          <div class="tl-left-head">
            PM / 專案
            <span class="spacer"></span>
            <span class="col-lbl c-pct">進度</span>
            <span class="col-lbl c-gap">落後</span>
          </div>
          <div ref="ruler" class="tl-ruler">
            <div class="tl-track">
              <div class="tl-months">
                <div
                  v-for="m in range.months"
                  :key="m.iso"
                  class="tl-month"
                  :style="{ '--md': m.days }"
                >
                  {{ m.iso }}
                </div>
              </div>
              <div class="tl-days">
                <div v-for="x in weekTicks" :key="x.idx" class="tl-day" :style="{ '--d': x.d }">
                  {{ x.dnum }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          ref="body"
          class="tl-body"
          :class="{ panning: pan.panning.value }"
          @scroll="onBodyScroll"
          @pointerdown="pan.onPointerDown"
        >
          <div class="tl-chart">
            <div class="tl-bg" aria-hidden="true">
              <i
                v-for="x in bgDays"
                :key="x.idx"
                class="day-bg"
                :class="{ mon: x.isMonday, today: x.isToday }"
                :style="{ '--d': x.d }"
              ></i>
            </div>
            <div class="today-line" :style="{ '--x': `${todayX}px` }"></div>
            <div class="today-tag" :style="{ '--x': `${todayX}px` }">今天</div>

            <TransitionGroup name="ov-group" tag="div" class="tl-groups" @before-leave="freezeLeave">
              <TimelineGroup
                v-for="g in groups"
                :key="g.pm.id"
                :group="g"
                :start-idx="range.startIdx"
                :dw="DW"
              />
            </TransitionGroup>
          </div>
        </div>

        <!-- 畫布專用的橫捲軸：從左欄右緣開始，內容寬 = 畫布寬，捲動範圍與 .tl-body 相同 -->
        <div ref="hbar" class="tl-hbar" @scroll="onBarScroll">
          <div class="tl-hbar-track"></div>
        </div>
      </div>
    </Transition>
  </OvPanel>
</template>

<style scoped>
/* 「今天」按鈕（照 GanttPanel） */
.today-btn {
  height: var(--ctrl-h);
  padding: 0 var(--sp-6);
  border: 1px solid var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger-text);
  border-radius: var(--r-control);
  cursor: pointer;
  font: inherit;
  font-size: var(--fs-meta);
  font-weight: var(--fw-medium);
  line-height: 1;
  transition:
    filter var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .today-btn:hover {
    filter: var(--hover-dim);
  }
}

.today-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.tl-empty {
  margin: var(--sp-6);
}

/* 尺規列：sticky 在面板標題列下方 */
.tl-ruler-row {
  position: sticky;
  top: calc(var(--ov-top, 0px) + var(--ov-head, 0px));
  z-index: 26;
  display: flex;
  align-items: stretch;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-1);
  transform: translateZ(0);
  backface-visibility: hidden;
}

.tl-left-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: var(--gantt-left);
  flex: 0 0 var(--gantt-left);
  height: var(--gantt-head);
  padding: 0 var(--sp-4) 0 var(--sp-6);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--text-muted);
  letter-spacing: 0.04em;
  border-right: 1px solid var(--border-1);
  background: var(--surface-2);
}

.spacer {
  flex: 1;
}

.tl-left-head .col-lbl {
  flex: 0 0 auto;
  font-size: var(--fs-date);
  letter-spacing: 0;
  text-align: right;
}

/* 欄寬同 TimelineProjectRow 的 .c-pct / .c-gap */
.c-pct {
  width: 78px;
}

.c-gap {
  width: 50px;
}

@media (max-width: 899px) {
  .c-pct {
    width: 40px;
  }

  .c-gap {
    width: 40px;
  }
}

.tl-ruler {
  flex: 1;
  min-width: 0;
  height: var(--gantt-head);
  overflow: hidden;
}

.tl-track {
  position: relative;
  width: calc(var(--tl-days) * var(--dw));
  height: var(--gantt-head);
}

.tl-months {
  display: flex;
  height: 26px;
  border-bottom: 1px solid var(--border-1);
}

.tl-month {
  flex: 0 0 calc(var(--md) * var(--dw));
  display: flex;
  align-items: center;
  min-width: 0;
  padding-left: var(--sp-4);
  border-right: 1px solid var(--border-1);
  font-family: var(--font-mono);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
}

.tl-days {
  position: relative;
  height: 28px;
}

/* 週刻度：只有週一，日期從分隔線右邊寫出去（寬度照內容，不受一天的寬度限制） */
.tl-day {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--d) * var(--dw));
  z-index: 1;
  display: flex;
  align-items: center;
  padding-left: var(--sp-2);
  border-left: 1px solid var(--border-control);
  font-family: var(--font-mono);
  font-size: var(--fs-date);
  line-height: 1;
  color: var(--text-2);
  white-space: nowrap;
}

/* 捲動容器：左欄與畫布一起水平捲；原生捲軸藏起來，改用下方的 .tl-hbar（觸控板 / Shift+滾輪照樣能捲） */
.tl-body {
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.tl-body::-webkit-scrollbar {
  display: none;
}

/* 畫布區可按住拖曳平移（左欄、速覽不行）；拖曳中不選字 */
.tl-body :deep(.p-canvas),
.tl-body :deep(.g-canvas) {
  cursor: grab;
  user-select: none;
}

.tl-body.panning,
.tl-body.panning :deep(*) {
  cursor: grabbing;
}

/* 只在畫布下方的捲軸：左邊讓出左欄寬 */
.tl-hbar {
  margin-left: var(--gantt-left);
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: 0 0 var(--r-panel) 0;
}

.tl-hbar-track {
  width: calc(var(--tl-days) * var(--dw));
  height: 1px;
}

/* isolation：速覽的 z-index 31 只在畫布內比，不會蓋過畫布外的 sticky 尺規 */
.tl-chart {
  position: relative;
  z-index: 0;
  isolation: isolate;
  width: calc(var(--gantt-left) + var(--tl-days) * var(--dw));
  min-height: 120px;
}

/* 畫布底層：週一分隔線、今天底色；列的 PM 淡色疊在它上面 */
.tl-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--gantt-left);
  width: calc(var(--tl-days) * var(--dw));
  z-index: -1;
  pointer-events: none;
}

.day-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--d) * var(--dw));
  width: var(--dw);
}

.day-bg.today {
  background: var(--bg-today);
}

.day-bg.mon {
  box-shadow: inset 1px 0 var(--border-1);
}

/* 今天線在 bar 之下（同 z-index、DOM 在前）；標籤在 bar 之上、sticky 左欄（30）之下 */
.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--gantt-left) + var(--x) - 1px);
  width: 2px;
  background: var(--today);
  z-index: 2;
  pointer-events: none;
}

/* 標籤底用 --danger 才有 4.5:1（B2 2083） */
.today-tag {
  position: absolute;
  top: var(--sp-3);
  left: calc(var(--gantt-left) + var(--x) + var(--r-badge));
  z-index: 26;
  padding: var(--r-2) var(--sp-3);
  border-radius: var(--r-badge);
  background: var(--danger);
  color: var(--surface-1);
  font-family: var(--font-mono);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  pointer-events: none;
}

/* 離場群組由 freezeLeave 釘成 absolute，以這層為基準（A20） */
.tl-groups {
  position: relative;
}
</style>
