<script setup lang="ts">
// 所有專案總覽頁（首頁 `/`）：頂欄 ＋ 卡片 / 時間軸兩種檢視，載入中與失敗時佔住內容區。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import LoadingState from '@/components/common/LoadingState.vue'
import CardBoard from '@/components/overview/CardBoard.vue'
import OverviewTimeline from '@/components/overview/OverviewTimeline.vue'
import OverviewTopBar from '@/components/overview/OverviewTopBar.vue'
import { holdHeight, releaseHeight } from '@/composables/heightTween'
import { useNow } from '@/composables/useNow'
import { usePortfolioBoot } from '@/composables/usePortfolioBoot'
import { useOverviewStore } from '@/stores/overview'

const ov = useOverviewStore()
const route = useRoute()
// 兩者都要在 setup 頂層呼叫：它們內部會註冊自己的 mounted / unmount 鉤子
const boot = usePortfolioBoot()
useNow()

const topBar = ref<InstanceType<typeof OverviewTopBar> | null>(null)
const column = ref<HTMLElement | null>(null)
/** 頂欄高度；寫進 `--ov-top`，面板標題列、欄首與時間軸尺規都 sticky 在它下面。 */
const topH = ref(0)
let ro: ResizeObserver | undefined

onMounted(() => {
  // 從 Dashboard 回來時不殘留開著的下拉
  ov.closeDropdown()
  // 第一次顯示載入中；之後回到總覽在背景重載、畫面不閃（spec 7b）
  void boot.reload()
  // 設計稿截圖與 e2e 的慣例：只在進頁時讀一次，切換檢視不會寫回網址
  if (route.hash === '#timeline') ov.setView('timeline')

  const el = topBar.value?.$el as HTMLElement | undefined
  if (!el) return
  topH.value = el.offsetHeight
  if (typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    topH.value = el.offsetHeight
  })
  ro.observe(el)
})

onBeforeUnmount(() => ro?.disconnect())

/**
 * 切檢視 / 載入完成（ov-view，out-in）：舊檢視拿掉、新的還沒掛上時頁面高度會塌掉、捲動位置被夾回頂端，
 * 所以離場前先把欄高寫死（heightTween）。
 */
function onViewLeave(): void {
  holdHeight(column.value)
}

/**
 * 新檢視剛插入、還透明時：
 * - 放開欄高，從舊高度補間到新檢視的高度。不等 @after-enter：等進場跑完才放開的話，捲得深時新檢視在視窗外淡入、
 *   結束那一幀捲動被夾而整頁跳（C6 / T11）；一插入就補間，頁高逐幀變、被夾的捲動也逐幀連續（Design M3）。
 * - 淡入立刻起步：ov-view 改用 transition（淡入中反悔可反向，M10）後，照 Vue 要等兩幀才拿掉 enter-from，
 *   新檢視多停兩幀全透明，這段時間 document.getAnimations() 也看不到它（e2e 等動畫跑完的判斷會提早放行）。
 *   先以 enter-from 算一次樣式當起點、再拿掉它，過渡當下就開始，起步時間同原本的 keyframes；之後 Vue 再拿是空操作。
 * 只收一個參數：Vue 仍自己偵測過渡結束。
 */
function onViewEnter(el: Element): void {
  releaseHeight(column.value)
  void (el as HTMLElement).offsetHeight
  el.classList.remove('ov-view-enter-from')
}
</script>

<template>
  <div class="ov" data-view="overview" :style="{ '--ov-top': `${topH}px` }">
    <OverviewTopBar ref="topBar" />
    <main class="content">
      <div ref="column" class="column">
        <!-- 載入完成換成內容（A18）、卡片 ↔ 時間軸（A10）共用同一個過渡；欄高的撐住與放開見 onViewLeave / onViewEnter -->
        <Transition name="ov-view" mode="out-in" @before-leave="onViewLeave" @enter="onViewEnter">
          <LoadingState
            v-if="ov.loadState !== 'ready'"
            key="loading"
            :state="ov.loadState"
            :error="ov.loadError"
            @retry="boot.reload()"
          />
          <CardBoard v-else-if="ov.view === 'cards'" key="cards" />
          <OverviewTimeline v-else key="timeline" />
        </Transition>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 版面照 DashboardView：整頁底色、內容區留白、單欄 */
.ov {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-page);
}

.content {
  display: flex;
  padding: var(--gap-boards);
  align-items: flex-start;
}

.column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-boards);
}
</style>
