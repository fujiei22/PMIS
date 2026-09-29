<script setup lang="ts">
// 卡片泳道的速覽抽屜：每條泳道一個，插在展開中那張卡「所在那一列」的正下方、橫跨整列，同列其他卡片不會被擠走。
// 每條泳道同時只展開一張（store 的 toggleExpandedInLane），照 iTunes 專輯網格的列下展開：
// - 同一列換一張：抽屜不收，內容直接換成新的一張，箭頭（在卡片上）跟著移過去；
// - 換到別列：先收起，再到新的那一列下方展開。
// 切 grid-template-rows 做高度過渡（A2）。收合且動畫跑完後 display: none：抽屜橫跨整列，
// 就算高度 0 也會佔一個 grid 位置，欄數還沒量到（或正在變）時會把同一列的卡片拆到下一列。
// display 用 style 綁，不用 v-show：抽屜在 PmLane 的 TransitionGroup 裡，v-show 會觸發群組的進出場，
// 收合時被 freezeLeave 釘成 absolute、高度 0，而且之後不會拿掉，再展開就看不到。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import QuickView from '@/components/overview/QuickView.vue'
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

const root = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

/** 先以 0fr 出現在版面上一次再切 1fr，高度過渡才跑得起來（從 display: none 直接給 1fr 會瞬間到位）。 */
async function grow(): Promise<void> {
  await nextTick()
  void root.value?.offsetHeight
  grown.value = true
}

watch(target, (t) => {
  clearTimeout(timer)
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
  // 同一列換一張：抽屜不收，只換內容
  if (isOpen && (cur.row.p.id === t.row.p.id || cur.order === t.order)) {
    shown.value = t
    return
  }
  // 換到別列：在舊位置收起，跑完再到新位置展開
  if (isOpen) {
    grown.value = false
    timer = setTimeout(() => {
      shown.value = t
      void grow()
    }, PANEL_UNMOUNT_MS)
    return
  }
  // 從收合（或收合途中）打開
  shown.value = t
  visible.value = true
  void grow()
})

onBeforeUnmount(() => clearTimeout(timer))

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
        <Transition name="ov-fade" appear>
          <div v-if="shown" class="drawer-box">
            <!-- 同列換一張時以 key 重掛，淡入新內容（抽屜本身不收） -->
            <QuickView :key="shown.row.p.id" class="drawer-content" :row="shown.row" with-head />
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

/* PM 色框（--pm-frame 由 PmLane 提供），和卡片上的箭頭同色 */
.drawer-box {
  background: var(--surface-1);
  border: 2px solid var(--pm-frame);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card-hover);
  overflow: hidden;
}

/* 換內容時淡入（不做淡出：新舊同時在 DOM 會讓高度瞬間變兩倍） */
.drawer-content {
  animation: fadeIn var(--t-fast) var(--ease);
}
</style>
