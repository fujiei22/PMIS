<script setup lang="ts">
// 卡片檢視：「專案看板」面板，每位 PM 一條橫向泳道；篩掉全部時面板照留，內容換成空狀態。
import OvEmpty from '@/components/overview/OvEmpty.vue'
import OvPanel from '@/components/overview/OvPanel.vue'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import PmLane from '@/components/overview/PmLane.vue'
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { cancelHeight, holdHeight, releaseHeight } from '@/composables/heightTween'
import { tokenMs } from '@/composables/motionTokens'
import { startLeaveNow, useCollapseReenter } from '@/composables/useCollapseReenter'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()

/**
 * 空狀態只延後「有 → 空」：泳道先原地收完（--t-panel）才判定真的沒結果，
 * 打出沒結果的字又馬上刪時看板不會整塊淡掉（C9：out-in 一開始離場就不能取消）。已經是空的（切檢視、初次掛載）立即顯示。
 */
const showEmpty = ref(overview.groups.length === 0)
let emptyTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => overview.groups.length === 0,
  (empty) => {
    clearTimeout(emptyTimer)
    if (!empty) showEmpty.value = false
    else emptyTimer = setTimeout(() => (showEmpty.value = true), tokenMs('--t-panel'))
  },
)
onBeforeUnmount(() => clearTimeout(emptyTimer))

/**
 * 看板 ↔ 空狀態交換時撐住面板高度的外框（T16）：舊的離場前把高度寫死，新的一插入（還透明）就從舊高度補間到新內容的高度，
 * 面板底邊與頁高逐幀變，不會在換的那一幀一次跳。
 */
const stage = ref<HTMLElement | null>(null)
// 切檢視、離開總覽時停掉進行中的補間：元件拿掉後 rAF 不會自己停
onBeforeUnmount(() => cancelHeight(stage.value))

/** 泳道清單（TransitionGroup）的根元素：同一位 PM 的泳道在收起途中又回來時，從當下的高度接續長回去。 */
const boardRef = ref<ComponentPublicInstance | null>(null)
const reenter = useCollapseReenter(
  computed(() => boardRef.value?.$el as HTMLElement | undefined),
  'data-lane-wrap',
)

/**
 * 離場的泳道：收起途中仍在版面流裡、看得到，但不能再 Tab 進去、點到或被讀屏讀成兩份。焦點在裡面就先移開。
 * 不讀任何樣式：進場中被離場時，這個 hook 呼叫的當下 enter-active 已拿掉、leave-active 還沒加，
 * 讀樣式逼瀏覽器重算的話，進行中的高度過渡會被取消、一幀跳到全高。
 */
function leaving(el: Element): void {
  const node = el as HTMLElement
  if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  node.inert = true
}
</script>

<template>
  <OvPanel title="專案看板" view="cards">
    <template #head>
      <OvSortControls />
    </template>
    <!-- 有欄 ↔ 空狀態之間淡入淡出（A17）；stage 撐住交換時的高度（hook 只收一個參數，Vue 仍自己偵測過渡結束） -->
    <div ref="stage" class="ov-stage">
      <Transition name="ov-fade" mode="out-in" @before-leave="holdHeight(stage)" @enter="releaseHeight(stage)">
        <!-- PM 泳道的進出與重排（A9）：原地收合 / 長出（ov-col，見 overview-motion.css） -->
        <TransitionGroup
          v-if="!showEmpty"
          ref="boardRef"
          name="ov-col"
          tag="div"
          class="board"
          @before-leave="leaving"
          @leave="startLeaveNow"
          @enter="reenter.onEnter"
          @vue:before-update="reenter.snapshot"
        >
          <div
            v-for="group in overview.groups"
            :key="group.pm.id"
            class="lane-wrap"
            :data-lane-wrap="group.pm.id"
            @vue:updated="reenter.resume"
          >
            <div class="lane-clip"><PmLane :group="group" /></div>
          </div>
        </TransitionGroup>
        <OvEmpty v-else />
      </Transition>
    </div>
  </OvPanel>
</template>

<style scoped>
/*
 * 交換用的外框（stage）。flow-root：子元素的上下 margin 不穿出去，撐住的高度與自然高度量的是同一個框（否則放開那一幀差一個 margin）。
 * clip：從空狀態長回看板時，外框還矮、看板已經在淡入，不裁的話會畫到面板框外；clip 不建立捲動容器，裡面的 sticky 照常黏住。
 */
.ov-stage {
  display: flow-root;
  overflow: clip;
}

/*
 * 泳道由上往下排。position: relative 保留（無害）：泳道是原地收合、不釘位（卡片的 freezeLeave 以 .lane-body 為基準）；
 * 也是 PmLane 窄版切換的容器（@container board）。
 * overflow-anchor: none：頁面已捲動時篩選 / 排序讓泳道換位置，瀏覽器的捲動錨定會同時調整捲動位置，
 * 和泳道 / 卡片的 FLIP 位移疊在一起，卡片會先跳一段再動畫；重排已有動畫帶到新位置，不需要錨定。
 * 泳道間距放在裁切層裡（.lane 的 margin-bottom），所以 gap 是 0、底部內距扣掉最後一條泳道的間距，留白總量不變。
 */
.board {
  position: relative;
  overflow-anchor: none;
  container: board / inline-size;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: var(--sp-6);
  padding-bottom: calc(var(--sp-6) - var(--sp-5));
  background: var(--surface-2);
  border-radius: 0 0 var(--r-panel) var(--r-panel);
}

/* 泳道外層：原地收合（ov-col，見 overview-motion.css）。間距用泳道的 margin-bottom，放在裁切層裡一起收 */
.lane-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

/*
 * 平常全高。寫在 :where() 裡讓特異度為 0：scoped 會加屬性選擇器（.lane-wrap[data-v-…] 比單一 class 高），
 * 直接寫在上面的話，進出場 class（ov-col-enter-from / leave-to 的 0fr）蓋不過，泳道一出現就是全高、只剩淡入淡出。
 */
:where(.lane-wrap) {
  grid-template-rows: 1fr;
}

.lane-clip {
  min-height: 0;
  min-width: 0;
  overflow: clip;
}

.lane-clip > .lane {
  margin-bottom: var(--sp-5);
}
</style>
