<script lang="ts">
/**
 * 換列補償期間關掉根元素的 scroll anchoring（見 followCollapse）。每條泳道各有一個抽屜，兩條泳道的補償可能重疊，
 * 所以記在模組層、參考計數：第一個開始時記下原值再關，最後一個結束才還原成原值（不是清空：別處可能也設了）。
 */
let anchorHolds = 0
let anchorPrev = ''

function suspendAnchoring(): void {
  const html = document.documentElement
  if (anchorHolds++ === 0) {
    anchorPrev = html.style.overflowAnchor
    html.style.overflowAnchor = 'none'
  }
}

function resumeAnchoring(): void {
  if (--anchorHolds === 0) document.documentElement.style.overflowAnchor = anchorPrev
}
</script>

<script setup lang="ts">
// 卡片泳道的速覽抽屜：每條泳道一個，插在展開中那張卡「所在那一列」的正下方、橫跨整列，同列其他卡片不會被擠走。
// 每條泳道同時只展開一張（store 的 toggleExpandedInLane），照 iTunes 專輯網格的列下展開：
// - 同一列換一張：抽屜不收，舊內容淡出、新內容淡入（交叉淡化），框高補間到新內容的高度，箭頭（在卡片上）跟著移過去；
// - 換到別列：先收起，再到新的那一列下方展開；新的一列在下方時，收合期間頁面跟著上捲，被點的卡停在原位。
// 切 grid-template-rows 做高度過渡（A2）。收合且動畫跑完後 display: none：抽屜橫跨整列，
// 就算高度 0 也會佔一個 grid 位置，欄數還沒量到（或正在變）時會把同一列的卡片拆到下一列。
// display 用 style 綁，不用 v-show：抽屜在 PmLane 的 TransitionGroup 裡，v-show 會觸發群組的進出場，
// 收合時被 freezeLeave 釘成 absolute、高度 0，而且之後不會拿掉，再展開就看不到。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import QuickView from '@/components/overview/QuickView.vue'
import { cancelHeight, holdHeight, releaseHeight } from '@/composables/heightTween'
import { PANEL_UNMOUNT_MS } from '@/constants/overview'
import type { ProjectRow } from '@/lib/portfolio'
import { useOverviewStore } from '@/stores/overview'

const props = defineProps<{
  pmId: string
  /** 泳道裡的卡片，順序同畫面。 */
  rows: ProjectRow[]
  /** 卡片網格目前一列放幾張。 */
  cols: number
}>()

const emit = defineEmits<{
  /** 抽屜實際展開在哪張卡下方（高度 1fr）；收起、收合途中是 null。卡片下緣的箭頭跟著它長出收起。 */
  'open-id': [id: string | null]
}>()

const overview = useOverviewStore()

interface Slot {
  row: ProjectRow
  /** grid 的 order：排在該列最後一張卡之後（第 i 張卡是 2i）。 */
  order: number
}

/** 這條泳道展開中的那張卡與抽屜該放的位置；沒有展開的就是 null。 */
const target = computed<Slot | null>(() => {
  const i = props.rows.findIndex((r) => overview.isExpanded(r.p.id))
  if (i < 0) return null
  const n = props.rows.length
  const c = props.cols
  return { row: props.rows[i]!, order: Math.min(n - 1, Math.floor(i / c) * c + c - 1) * 2 + 1 }
})

/** 目前畫出來的內容與位置；換列時會先停在舊位置收起，才換到新位置。 */
const shown = ref<Slot | null>(target.value)
/** 是否佔版面（display）。 */
const visible = ref(target.value !== null)
/** 高度是否已展開（1fr）。 */
const grown = ref(target.value !== null)

// 箭頭跟著抽屜「實際」展開的卡，不跟選取：換列時要等舊抽屜收完才到新的一列展開，store 早就切到新卡了（動畫稽核 C11）。
// 和切 1fr 在同一次更新裡送出，箭頭與抽屜高度從同一幀開始過渡
watch([shown, grown], () => emit('open-id', grown.value ? (shown.value?.row.p.id ?? null) : null), {
  immediate: true,
})

const root = ref<HTMLElement | null>(null)
const box = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
/** 換列等待中（舊抽屜在舊列收合、計時到了才到新列展開）的目標；計時器到了用它。 */
let pending: Slot | null = null

/** 使用者自己捲動的輸入：收到就停掉換列補償。pointerdown：拖捲軸、在畫面上按下（觸發換列的那一下在補償開始前就過了）。 */
const USER_SCROLL = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
/** 進行中的換列補償；呼叫就停。 */
let stopFollow: (() => void) | undefined

/**
 * 換列補償捲動（動畫稽核 C8）：換到下方的列時，被點的卡在舊抽屜下方，抽屜收多少它就上移多少，
 * 不補的話卡片會在收合途中滑出畫面上緣。收合期間每幀量抽屜的底邊，把頁面捲回讓底邊停在起點
 * （等於捲掉這一幀收掉的高度）；量位置不量高度差：頁面捲在最底時瀏覽器自己會把捲動往上夾，量位置才不會補兩次。
 * 期間關掉根元素的 scroll anchoring（suspendAnchoring，兩條泳道重疊時最後一條結束才還原）：
 * 瀏覽器挑到抽屜下方的元素當錨點時也會補，兩者疊加就是稽核看到的中段拉回。
 * 使用者自己捲（滾輪、觸控、按鍵、按下滑鼠或觸控筆）、再換一次、或舊抽屜收完就停。
 */
function followCollapse(): void {
  stopFollow?.()
  const el = root.value
  if (!el) return
  const anchor = el.getBoundingClientRect().bottom
  const t0 = performance.now()
  let raf = 0
  const step = (): void => {
    const shift = el.getBoundingClientRect().bottom - anchor
    if (Math.abs(shift) >= 0.5) window.scrollBy({ top: shift, behavior: 'instant' })
    raf = requestAnimationFrame(step)
  }
  // 用鍵盤換列時，卡片的 keydown 裡就切了選取，這裡在同一個事件冒泡到 window 之前就跑完，剛掛上的監聽會收到那個 Enter；
  // 它不是使用者捲動，以時間排除（所以不用 once，停的時候自己拿掉）。滾輪、觸控、按下不會在這之後才觸發換列
  // （點擊換列時 pointerdown 在 click 之前），一收到就停
  const onUser = (e: Event): void => {
    if (e.type !== 'keydown' || e.timeStamp >= t0) stop()
  }
  let stopped = false
  const stop = (): void => {
    // 只還原一次：scroll anchoring 是參考計數
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    resumeAnchoring()
    for (const type of USER_SCROLL) window.removeEventListener(type, onUser)
    if (stopFollow === stop) stopFollow = undefined
  }
  suspendAnchoring()
  for (const type of USER_SCROLL) window.addEventListener(type, onUser, { passive: true })
  raf = requestAnimationFrame(step)
  stopFollow = stop
}

/** 先以 0fr 出現在版面上一次再切 1fr，高度過渡才跑得起來（從 display: none 直接給 1fr 會瞬間到位）。 */
async function grow(): Promise<void> {
  await nextTick()
  void root.value?.offsetHeight
  grown.value = true
}

watch(target, (t) => {
  // 換列等待中又來一個「同一張卡、同一個位置」的 target：別條泳道的選取變了，expandedIds 換新、這裡重算出內容相同的新物件。
  // 照原本的計時繼續在舊列收合，只換成新的資料物件——否則這時 grown 已是 false，會被當成「從收合途中打開」，
  // 收到一半的抽屜直接搬到新列展開（批次 B review 發現的既有 bug）
  if (pending && t && t.row.p.id === pending.row.p.id && t.order === pending.order) {
    pending = t
    return
  }
  pending = null
  clearTimeout(timer)
  stopFollow?.()
  const cur = shown.value
  const isOpen = cur !== null && visible.value && grown.value
  if (!t) {
    grown.value = false
    timer = setTimeout(() => {
      visible.value = false
      shown.value = null
    }, PANEL_UNMOUNT_MS)
    return
  }
  // 同一張卡只是位置變了（視窗寬度改變欄數、篩選讓前面的卡離開）：直接移過去
  // 同一列換一張：抽屜不收，只換內容。框高先撐在舊內容的高度，換完再補間到新內容的高度
  // （舊內容改疊在上面淡出、不佔高度，見 pinOld），抽屜不會一幀變高變矮（C12）
  if (isOpen && (cur.row.p.id === t.row.p.id || cur.order === t.order)) {
    if (cur.row.p.id !== t.row.p.id) {
      holdHeight(box.value)
      void nextTick(() => releaseHeight(box.value))
    }
    shown.value = t
    return
  }
  // 換到別列：在舊位置收起，跑完再到新位置展開；新的一列在下方時收合期間補償捲動
  if (isOpen) {
    grown.value = false
    if (t.order > cur.order) followCollapse()
    pending = t
    timer = setTimeout(() => {
      stopFollow?.()
      shown.value = pending ?? t
      pending = null
      void grow()
    }, PANEL_UNMOUNT_MS)
    return
  }
  // 從收合（或收合途中）打開
  shown.value = t
  visible.value = true
  void grow()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  stopFollow?.()
  // 同列換卡的框高補間到一半泳道就被篩掉：停掉補間（元件拿掉後 rAF 不會自己停）
  cancelHeight(box.value)
})

/**
 * 同列換一張時，離場的舊內容疊在新內容上方淡出（C12）：absolute 不佔高度，框高才能從舊內容補間到新內容；
 * inert：淡出中的「進入」連結不能 Tab、不能點。
 */
function pinOld(el: Element): void {
  const node = el as HTMLElement
  node.style.position = 'absolute'
  node.style.inset = '0 0 auto 0'
  node.inert = true
}

/**
 * A28：高度過渡跑完後，把抽屜捲到看得見的地方。
 * 要等過渡結束才量得到最終高度；scroll-margin 已預留 sticky 頂欄與面板標題列。
 */
function onTransitionEnd(e: TransitionEvent): void {
  // 速覽裡面的淡入等過渡也會冒泡上來，只認自己的高度過渡
  if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return
  if (grown.value) root.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
</script>

<template>
  <div
    :id="`lane-qv-${pmId}`"
    ref="root"
    class="drawer"
    :class="{ 'is-open': grown }"
    :data-drawer="shown?.row.p.id"
    :style="{
      order: shown?.order ?? 0,
      gridTemplateRows: grown ? '1fr' : '0fr',
      display: visible ? undefined : 'none',
    }"
    @transitionend="onTransitionEnd"
  >
    <div class="drawer-clip">
      <!-- 列間距放在裁切層裡面，跟著高度一起展開 / 收合，收合時不留空隙 -->
      <div class="drawer-pad">
        <!--
          不加 appear：切回卡片檢視、從 Dashboard 返回時抽屜一掛上就是展開的，跟著檢視 / 頁面的淡入一起出現；
          再自己淡一次就會比頁面晚出現（C14）
        -->
        <Transition name="ov-fade">
          <div v-if="shown" ref="box" class="drawer-box">
            <!-- 同列換一張時以 key 重掛，新舊同時在：舊的疊在上面淡出、新的淡入（抽屜本身不收） -->
            <Transition name="ov-fade" @before-leave="pinOld">
              <QuickView :key="shown.row.p.id" class="drawer-content" :row="shown.row" with-head />
            </Transition>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 橫跨整列；grid-template-rows 0fr ↔ 1fr 做高度過渡，值由 inline style 切 */
.drawer {
  grid-column: 1 / -1;
  display: grid;
  scroll-margin-top: calc(var(--ov-top, 0px) + var(--ov-head, 0px) + var(--sp-6));
  scroll-margin-bottom: var(--sp-6);
  transition: grid-template-rows var(--t-panel) var(--ease);
}

.drawer-clip {
  min-height: 0;
  overflow: hidden;
}

.drawer-pad {
  padding-bottom: var(--sp-5);
}

/* PM 色框（--pm-frame 由 PmLane 提供），和卡片上的箭頭同色；relative：同列換卡時淡出中的舊內容疊在這裡面 */
.drawer-box {
  position: relative;
  background: var(--surface-1);
  border: 2px solid var(--pm-frame);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card-hover);
  overflow: hidden;
}
</style>
