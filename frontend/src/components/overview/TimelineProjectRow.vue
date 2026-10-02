<script setup lang="ts">
// 時間軸的一個專案：sticky 左欄（名稱、進度、落後）＋ 畫布上的 bar，底下接一塊可展開的速覽。
// 速覽外殼永遠在 DOM，展開收合只改 grid-template-rows，內容用延遲卸載撐到動畫跑完。
import { computed, ref } from 'vue'
import QuickView from '@/components/overview/QuickView.vue'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'
import { BADGE_CLASS, PANEL_UNMOUNT_MS } from '@/constants/overview'
import { dayIndex } from '@/lib/date'
import { gapTone, type ProjectRow } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const props = defineProps<{
  row: ProjectRow
  /** 時間軸範圍起點的絕對日索引。 */
  startIdx: number
  /** 一天的寬（px）。 */
  dw: number
}>()

const overview = useOverviewStore()

const p = computed(() => props.row.p)
const d = computed(() => props.row.d)

/** 展開狀態放在 store（expandedIds），卡片與時間軸共用，可同時展開多列。 */
const open = computed(() => overview.isExpanded(p.value.id))
/**
 * 收合動畫跑完前先別把速覽內容拿掉（A3 / A27）。
 * .qv-cap 不用這個，直接 v-show="open"：跟速覽的 grid 過渡同一刻開始淡（T9），不然速覽收完了色框還留在列上。
 * 用 v-show 不用 v-if：收合途中又點開時還是同一個元素，透明度從當下接續；v-if 會把淡到一半的拿掉、換一個從 0 淡入（閃一下）。
 */
const mounted = useDelayedUnmount(open, PANEL_UNMOUNT_MS)

/**
 * bar 的位置與寬度，px 直接寫 inline，不四捨五入（日寬 7.04 不是整數，捨入會累積誤差）。
 * 寬度用 totalDays（頭尾兩天都算，bar 蓋到到期日當天），和 Dashboard 甘特的 lengthOf 一致。
 */
const barStyle = computed(() => ({
  left: `${(dayIndex(p.value.startDate) - props.startIdx) * props.dw}px`,
  width: `${d.value.totalDays * props.dw}px`,
}))

const rowTitle = computed(
  () => `${p.value.name}｜${p.value.startDate} → ${p.value.dueDate}｜${d.value.totalDays} 天`,
)

function toggle(): void {
  overview.toggleExpanded(p.value.id)
}

function onKey(e: KeyboardEvent): void {
  // 只處理列本身的按鍵；焦點在列內其他元素時不攔
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') {
    // 空白鍵預設會捲動頁面
    e.preventDefault()
    toggle()
  }
}

const qv = ref<HTMLElement | null>(null)

/**
 * 展開動畫結束後，若速覽落在畫面外就把它捲進來（A28）；只捲垂直方向，所以對 .qv 呼叫。
 * 只有最後展開的那列捲（T17；expandedIds 依展開先後排列）：很快連開兩列時，先開那列展開完就開始平滑捲動，
 * 後開那列展開完時以捲到一半的位置判斷「看得見、不用捲」，先開那段捲動卻照跑，把後開那列推到黏住的標頭底下。
 */
function onWrapTransitionEnd(e: TransitionEvent): void {
  if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return
  const ids = overview.expandedIds
  if (!open.value || ids[ids.length - 1] !== p.value.id) return
  qv.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
</script>

<template>
  <div class="p-block" :class="[BADGE_CLASS[d.badge], { 'is-open': open }]" :data-project="p.id">
    <div
      class="p-row"
      role="button"
      tabindex="0"
      :aria-expanded="open"
      :data-selected="open || undefined"
      :title="rowTitle"
      @click="toggle"
      @keydown="onKey"
    >
      <div class="p-left">
        <svg class="caret p-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="p-name">{{ p.name }}</span>
        <span class="p-num c-pct" :title="`實際進度 ${d.actualPct}% / 理論進度 ${d.plannedPct}%`"
          >{{ d.actualPct }}%<span class="pct-plan"> / {{ d.plannedPct }}%</span></span
        >
        <span class="p-num c-gap" :class="gapTone(d.gap)">{{ d.gap }}%</span>
      </div>
      <div class="p-canvas">
        <div class="bar" :style="barStyle"><span class="bar-label">{{ p.name }}</span></div>
      </div>
    </div>

    <div ref="qv" class="qv">
      <Transition name="ov-fade"><i v-show="open" class="qv-cap"></i></Transition>
      <div
        class="quick-wrap"
        :style="{ gridTemplateRows: open ? '1fr' : '0fr' }"
        @click.stop
        @transitionend="onWrapTransitionEnd"
      >
        <div class="quick-clip">
          <div class="qv-pad">
            <div class="qv-box">
              <!-- 不加 appear：切到時間軸、從 Dashboard 返回時展開中的速覽跟著檢視 / 頁面的淡入一起出現，自己再淡一次會比頁面晚（C14） -->
              <Transition name="ov-fade">
                <QuickView v-if="mounted" :row="row" with-head />
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 狀態色：bar 與狀態點都讀 --bar / --dot（B2 2220） */
.p-block.late {
  --bar: var(--st-delayed-bar);
  --dot: var(--st-delayed-dot);
}

.p-block.paused {
  --bar: var(--st-paused-bar);
  --dot: var(--st-paused-dot);
}

.p-block.doing {
  --bar: var(--st-doing-bar);
  --dot: var(--st-doing-dot);
}

.p-block.todo {
  --bar: var(--st-todo-bar);
  --dot: var(--st-todo-dot);
}

.p-block.done {
  --bar: var(--st-done-bar);
  --dot: var(--st-done-dot);
}

.p-row {
  display: flex;
  height: var(--gantt-row);
  cursor: pointer;
}

.p-row:focus-visible {
  outline: none;
}

/* sticky 左欄：z-index 30 高於今天標籤（26），橫捲時標籤不會蓋到左欄 */
.p-left {
  position: sticky;
  left: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 0 0 var(--gantt-left);
  width: var(--gantt-left);
  padding: 0 var(--sp-4) 0 var(--sp-6);
  background: var(--pm-row);
  border-right: 1px solid var(--border-1);
  border-bottom: 1px solid var(--border-hair);
  box-shadow: var(--shadow-left-col);
  transition:
    background var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.p-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  background: var(--pm-row-t);
  border-bottom: 1px solid var(--border-hair);
  transition: background var(--t-fast) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .p-row:hover .p-left {
    background: var(--pm-row-hover);
  }
}

.p-row:focus-visible .p-left {
  box-shadow: inset var(--ring-focus);
}

/* 選取（＝速覽展開中）：改用該 PM 色系（A26） */
.p-row[data-selected='true'] .p-left {
  background: var(--pm-sel);
}

.p-row[data-selected='true'] .p-canvas {
  background: var(--pm-sel-t);
}

.p-caret {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  color: var(--text-3);
  transform: rotate(-90deg);
  transition:
    transform var(--t-layout) var(--ease),
    color var(--t-fast) var(--ease);
}

.p-block.is-open .p-caret {
  transform: none;
  color: var(--pm-ink);
}

.p-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-14);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--t-fast) var(--ease);
}

.p-block.is-open .p-name {
  font-weight: var(--fw-bold);
  color: var(--pm-ink);
}

.p-num {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-date);
  color: var(--text-3);
  text-align: right;
  white-space: nowrap;
}

/* 欄寬要和尺規列 .tl-left-head 的欄名對齊 */
.c-pct {
  width: 78px;
}

.c-gap {
  width: 50px;
}

.p-num.c-pct {
  color: var(--text-1);
  font-weight: var(--fw-medium);
}

/* 理論進度是對照值，用次要字色，視線先落在實際進度 */
.pct-plan {
  color: var(--text-3);
  font-weight: var(--fw-regular);
}

/* 平板直向：左欄縮成 260px（OverviewTimeline 的 TIMELINE_LEFT_W_NARROW），只留實際 %；理論 % 在速覽裡看得到 */
@media (max-width: 899px) {
  .c-pct {
    width: 40px;
  }

  .c-gap {
    width: 40px;
  }

  .pct-plan {
    display: none;
  }
}

.p-num.behind {
  color: var(--danger-text);
  font-weight: var(--fw-bold);
}

.p-num.warn {
  color: var(--ist-paused-fg);
  font-weight: var(--fw-bold);
}

/*
 * bar：實色、條內只放白字專案名；進度看左欄的 % 欄。
 * overflow 用 clip 不用 hidden：hidden 會讓 bar 自己變成捲動容器，名稱的 sticky 就只對 bar 生效、跟不上橫捲。
 */
.bar {
  position: absolute;
  top: 6px;
  height: 22px;
  display: flex;
  align-items: center;
  padding: 0 7px;
  border-radius: var(--r-6);
  background: var(--bar);
  box-shadow: var(--shadow-bar);
  overflow: clip;
  z-index: 2;
  transition: box-shadow var(--t-fast) var(--ease);
}

/*
 * Noto Sans TC 的行框上方留白比下方多，flex 置中後字形實測偏下約 1.5px。
 * 字的基線會對齊裝置像素，底部內距 1～2px 在 1x / 1.25x / 1.5x / 2x 實測結果都相同且最接近置中，取中間值；
 * 3px 以上在 2x 反而偏上。不用 text-box：cap 會切掉漢字上下緣，ideographic 目前 Chromium 不支援。
 * 左邊只留 .bar 的 7px 內距。
 * sticky：bar 的起點捲到左欄底下時，名稱停在左欄右緣再 7px（相對 .tl-body 捲動），直到被 bar 的右端推走。
 */
.bar-label {
  position: sticky;
  left: calc(var(--gantt-left) + 7px);
  min-width: 0;
  padding-bottom: 1.5px;
  font-size: var(--fs-date);
  font-weight: var(--fw-medium);
  color: var(--surface-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* hover 與選取時的光暈（A25）；不用 filter: brightness。hover 只給有滑鼠的裝置 */
.p-row {
  --bar-glow:
    0 0 0 1px color-mix(in srgb, var(--bar) 55%, transparent),
    0 0 6px 1.5px color-mix(in srgb, var(--bar) 50%, transparent),
    0 0 12px 4px color-mix(in srgb, var(--bar) 20%, transparent);
}

.p-row[data-selected='true'] .bar {
  box-shadow: var(--bar-glow);
}

@media (hover: hover) {
  .p-row:hover .bar {
    box-shadow: var(--bar-glow);
  }
}

/* 速覽：緊接在選取列下方，寬 = 可見寬度（sticky left:0，橫跨左欄 + 畫布）。
   z-index 31 高於 sticky 左欄（30），選取列上的框線才不會被左欄蓋住。
   scroll-margin-top 避開 sticky 的面板標題列與尺規列（--gantt-head 加 1px 底線）。 */
.qv {
  position: sticky;
  left: 0;
  z-index: 31;
  width: var(--view-w, 100%);
  scroll-margin-top: calc(var(--ov-top, 0px) + var(--ov-head, 0px) + var(--gantt-head) + 1px);
}

/* 畫在選取列上的 PM 色框（上、左、右），和 .qv-box 的左、右、下無縫相連 */
.qv-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: var(--gantt-row);
  border: 2px solid var(--pm-frame);
  border-bottom: 0;
  border-radius: var(--r-4) var(--r-4) 0 0;
  pointer-events: none;
}

/* 色框兩向都跟速覽的 grid 過渡同長（--t-panel），一起長出、一起收；寫在元件內特異度較高，蓋過共用 ov-fade 的 --t-base */
.qv-cap.ov-fade-enter-active,
.qv-cap.ov-fade-leave-active {
  transition: opacity var(--t-panel) var(--ease);
}

.quick-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  transition: grid-template-rows var(--t-panel) var(--ease);
  cursor: default;
}

.quick-clip {
  min-height: 0;
  overflow: hidden;
}

.qv-pad {
  padding-bottom: var(--sp-5);
  background: var(--pm-row);
}

.qv-box {
  background: var(--surface-1);
  border: 2px solid var(--pm-frame);
  border-top: 0;
  border-radius: 0 0 var(--r-card) var(--r-card);
  box-shadow: var(--shadow-card-hover);
}

/* 時間軸速覽的四組框線跟著需注意程度走（B2 2482） */
.p-block.late .qv :deep(.qb) {
  border-color: var(--danger-bd);
}

.p-block.paused .qv :deep(.qb) {
  border-color: var(--ist-paused-bd);
}
</style>
