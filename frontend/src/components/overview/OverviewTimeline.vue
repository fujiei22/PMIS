<script setup lang="ts">
// 時間軸檢視：面板外殼 + sticky 尺規（月份 / 週刻度）+ 可橫捲的畫布（週一分隔線、今天底色、今天線、PM 群組）。
// 左欄與畫布放在同一個水平捲動容器裡（左欄 sticky left），速覽才能緊接在選取列下方、橫跨左欄 + 畫布。
// 容器自己的橫捲軸藏起來，底下另放一條只在畫布下方的捲軸；左欄不會橫捲，捲軸不該伸到它下面。
// 畫布區也能按住拖曳左右平移（useDragPan）。
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import OvEmpty from '@/components/overview/OvEmpty.vue'
import OvPanel from '@/components/overview/OvPanel.vue'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import TimelineGroup from '@/components/overview/TimelineGroup.vue'
import { cancelHeight, holdHeight, releaseHeight } from '@/composables/heightTween'
import { tokenMs } from '@/composables/motionTokens'
import { startLeaveNow, useCollapseReenter } from '@/composables/useCollapseReenter'
import { useDragPan } from '@/composables/useDragPan'
import { NARROW_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { TIMELINE_DAY_W, TIMELINE_LEFT_W, TIMELINE_LEFT_W_NARROW } from '@/constants/overview'
import { dayFraction } from '@/lib/date'
import { easeOutQuart, scrollTweenMs } from '@/lib/scrollTween'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()
const clock = useClockStore()

const DW = TIMELINE_DAY_W

const range = computed(() => overview.range)
const groups = computed(() => overview.groups)

/**
 * 空狀態只延後「有 → 空」：群組先原地收完（--t-panel）才判定真的沒結果，
 * 打出沒結果的字又馬上刪時時間軸不會整塊淡掉（C9：out-in 一開始離場就不能取消）。已經是空的（切檢視、初次掛載）立即顯示。
 */
const showEmpty = ref(groups.value.length === 0)
let emptyTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => groups.value.length === 0,
  (empty) => {
    clearTimeout(emptyTimer)
    if (!empty) showEmpty.value = false
    else emptyTimer = setTimeout(() => (showEmpty.value = true), tokenMs('--t-panel'))
  },
)

/**
 * 時間軸 ↔ 空狀態交換時撐住面板高度的外框（T16，同 CardBoard 的 stage）：舊的離場前把高度寫死，
 * 新的一插入（還透明）就從舊高度補間到新內容的高度，面板底邊與頁高逐幀變。
 */
const stage = ref<HTMLElement | null>(null)

/** 群組清單（TransitionGroup）的根元素：同一位 PM 的群組在收起途中又回來時，從當下的高度接續長回去。 */
const groupsRef = ref<ComponentPublicInstance | null>(null)
const reenter = useCollapseReenter(
  computed(() => groupsRef.value?.$el as HTMLElement | undefined),
  'data-g-wrap',
)

/**
 * 離場的群組：收起途中仍在版面流裡、看得到，但不能再 Tab 進去、點到或被讀屏讀成兩份。焦點在裡面就先移開。
 * 不讀任何樣式（理由同 CardBoard 的 leaving：進場中被離場時，讀樣式會取消進行中的高度過渡、一幀跳到全高）。
 */
function leaving(el: Element): void {
  const node = el as HTMLElement
  if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  node.inert = true
}

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
 * 回音一定要略過：容器正在平滑捲動（滾輪、觸控板慣性）時，回寫 scrollLeft 會打斷它。
 */
function onBarScroll(): void {
  if (!hbar.value || !body.value) return
  if (Math.abs(hbar.value.scrollLeft - barEcho) < 1) return
  body.value.scrollLeft = hbar.value.scrollLeft
}

/** 正在跑的「今天」捲動補間；被取消或重新開始時換掉，已排隊的那一幀看到不是自己就不再寫（同 useGanttScroll）。 */
let todayAnim: { raf: number } | null = null

/** 停掉「今天」的捲動補間：使用者自己捲 / 拖、捲動容器換一顆、卸載時。 */
function stopToday(): void {
  if (todayAnim) cancelAnimationFrame(todayAnim.raf)
  todayAnim = null
}

/**
 * 畫布上按下：先停掉「今天」的補間（否則拖曳的起點是補間途中的位置，放手後又被拉回今天），再交給拖曳平移。
 * 合成一個 handler、不另掛 @pointerdown.capture：同一個事件經過兩個 Vue listener 時，
 * Vue 以 Date.now() 判斷事件是否早於 listener 掛上，e2e 固定時鐘（clock.setFixedTime）下第二個會被略過。
 */
function onBodyPointerDown(e: PointerEvent): void {
  stopToday()
  pan.onPointerDown(e)
}

/**
 * 把今天置中到畫布可見區（扣掉左欄）；smooth 給按鈕（A14），auto 給初次掛載。
 * smooth 不用原生 scrollTo：原生平滑捲動由合成器推進，scroll 事件晚一幀才同步尺規，
 * 捲動途中週刻度和畫布錯開（動畫稽核 T10）。改用 rAF 補間，每一幀同時設定本體、尺規與捲軸；
 * 時長與曲線與甘特的程式捲動同一條（lib/scrollTween）。
 */
function scrollToToday(behavior: ScrollBehavior): void {
  const el = body.value
  if (!el) return
  stopToday()
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  const left = Math.min(max, Math.max(0, todayX.value - (el.clientWidth - leftW.value) / 2))
  const from = el.scrollLeft
  if (behavior !== 'smooth' || Math.abs(left - from) < 1.5) {
    el.scrollTo({ left, behavior: 'auto' })
    return
  }
  const dur = scrollTweenMs(left - from)
  const t0 = performance.now()
  const self = { raf: 0 }
  const step = (now: number): void => {
    if (todayAnim !== self) return
    // rAF 的時間戳可能比按下按鈕的時間早一點，夾在 0 以上才不會先往反方向退
    const p = Math.min(1, Math.max(0, (now - t0) / dur))
    el.scrollLeft = from + (left - from) * easeOutQuart(p)
    onBodyScroll()
    if (p < 1) self.raf = requestAnimationFrame(step)
    else todayAnim = null
  }
  todayAnim = self
  self.raf = requestAnimationFrame(step)
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
    stopToday()
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

onBeforeUnmount(() => {
  stopToday()
  ro?.disconnect()
  clearTimeout(emptyTimer)
  // 停掉 stage 進行中的高度補間：元件拿掉後 rAF 不會自己停
  cancelHeight(stage.value)
})
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

    <!-- 時間軸 ↔ 空狀態之間淡入淡出（A17）；stage 撐住交換時的高度（hook 只收一個參數，Vue 仍自己偵測過渡結束） -->
    <div ref="stage" class="ov-stage">
      <Transition
        name="ov-fade"
        mode="out-in"
        @before-leave="holdHeight(stage)"
        @enter="releaseHeight(stage)"
      >
        <OvEmpty v-if="showEmpty" key="empty" class="tl-empty" />
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

          <!-- 使用者自己捲 / 拖就停掉「今天」的補間 -->
          <div
            ref="body"
            class="tl-body"
            :class="{ panning: pan.panning.value }"
            @scroll="onBodyScroll"
            @pointerdown="onBodyPointerDown"
            @wheel.passive="stopToday"
            @touchstart.passive="stopToday"
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

              <!-- PM 群組的進出與重排（A20）：原地收合 / 長出（ov-group，見 overview-motion.css） -->
              <TransitionGroup
                ref="groupsRef"
                name="ov-group"
                tag="div"
                class="tl-groups"
                @before-leave="leaving"
                @leave="startLeaveNow"
                @enter="reenter.onEnter"
                @vue:before-update="reenter.snapshot"
              >
                <div
                  v-for="g in groups"
                  :key="g.pm.id"
                  class="g-wrap"
                  :data-g-wrap="g.pm.id"
                  @vue:updated="reenter.resume"
                >
                  <div class="g-wrap-clip">
                    <TimelineGroup :group="g" :start-idx="range.startIdx" :dw="DW" />
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- 畫布專用的橫捲軸：從左欄右緣開始，內容寬 = 畫布寬，捲動範圍與 .tl-body 相同 -->
          <div
            ref="hbar"
            class="tl-hbar"
            @scroll="onBarScroll"
            @pointerdown="stopToday"
            @wheel.passive="stopToday"
            @touchstart.passive="stopToday"
          >
            <div class="tl-hbar-track"></div>
          </div>
        </div>
      </Transition>
    </div>
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

/* 交換用的外框：flow-root 讓空狀態的 margin 算在框內、clip 不讓長回時的時間軸畫到面板框外（理由同 CardBoard 的 .ov-stage） */
.ov-stage {
  display: flow-root;
  overflow: clip;
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

/* position: relative 保留（無害）：群組是原地收合、不釘位（A20；列的 useRelativeFlip 以各自的 .g-list 為基準） */
.tl-groups {
  position: relative;
}

/* 群組外層：原地收合（ov-group，見 overview-motion.css） */
.g-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

/*
 * 平常全高。寫在 :where() 裡讓特異度為 0：scoped 會加屬性選擇器（.g-wrap[data-v-…] 比單一 class 高），
 * 直接寫在上面的話，進出場 class（ov-group-enter-from / leave-to 的 0fr）蓋不過，群組一出現就是全高、只剩淡入淡出。
 */
:where(.g-wrap) {
  grid-template-rows: 1fr;
}

/* 一定要 clip 不能 hidden：hidden 會成為捲動容器，.g-left / .p-left / .qv 的 sticky left:0 就失效（同 TimelineGroup 的 .g-clip） */
.g-wrap-clip {
  min-height: 0;
  min-width: 0;
  overflow: clip;
}

/* 群組之間的分隔線畫在群組本體（裁切層裡），收起時跟著一起收；留在外層的話收到最後剩 1px、移除那一幀跳一下 */
.g-wrap + .g-wrap .g {
  border-top: 1px solid var(--border-1);
}
</style>
