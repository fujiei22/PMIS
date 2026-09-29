<script setup lang="ts">
// 所有專案總覽頁（首頁 `/`）：頂欄 ＋ 卡片 / 時間軸兩種檢視，載入中與失敗時佔住內容區。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import LoadingState from '@/components/common/LoadingState.vue'
import CardBoard from '@/components/overview/CardBoard.vue'
import OverviewTimeline from '@/components/overview/OverviewTimeline.vue'
import OverviewTopBar from '@/components/overview/OverviewTopBar.vue'
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
 * out-in 切換時，舊檢視已拿掉、新的還沒掛上，這段時間頁面高度會塌掉，
 * 捲動位置被夾回頂端。離場前先把欄高撐住，進場完成再放開。
 */
function holdHeight(): void {
  const el = column.value
  if (el) el.style.minHeight = `${el.offsetHeight}px`
}
function releaseHeight(): void {
  if (column.value) column.value.style.minHeight = ''
}
</script>

<template>
  <div class="ov" data-view="overview" :style="{ '--ov-top': `${topH}px` }">
    <OverviewTopBar ref="topBar" />
    <main class="content">
      <div ref="column" class="column">
        <!-- 載入完成換成內容（A18）、卡片 ↔ 時間軸（A10）共用同一個過渡 -->
        <Transition
          name="ov-view"
          mode="out-in"
          @before-leave="holdHeight"
          @after-enter="releaseHeight"
        >
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
