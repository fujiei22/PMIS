<script setup lang="ts">
// Dashboard 主畫面：載資料、組頂部列 + 摘要卡 + 三個面板，並掛全域的點擊外部與時鐘。
import { onBeforeUnmount, onMounted, watch } from 'vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import LoadingState from '@/components/common/LoadingState.vue'
import OptionMenu from '@/components/common/OptionMenu.vue'
import DetailModal from '@/components/detail/DetailModal.vue'
import ImageLightbox from '@/components/detail/ImageLightbox.vue'
import DependencyEditor from '@/components/dialogs/DependencyEditor.vue'
import GanttPanel from '@/components/gantt/GanttPanel.vue'
import RowActionMenu from '@/components/gantt/RowActionMenu.vue'
import IssuePanel from '@/components/issues/IssuePanel.vue'
import KanbanPanel from '@/components/kanban/KanbanPanel.vue'
import TopBar from '@/components/layout/TopBar.vue'
import SummaryCards from '@/components/summary/SummaryCards.vue'
import { useClickOutside } from '@/composables/useClickOutside'
import { useConfirmProps } from '@/composables/useConfirmProps'
import { provideDeferredPanels } from '@/composables/useDeferredPanels'
import { provideDomRegistry } from '@/composables/useDomRegistry'
import { clearMenuAnchors } from '@/composables/useMenus'
import { useNow } from '@/composables/useNow'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { useStickyOffsets } from '@/composables/useStickyOffsets'
import { isPageSwapping, swapRestoresScroll } from '@/router/pageSwap'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
// 資料只從這裡進來一次、後端事件也只在這裡訂閱一次（契約 B / E、review M6）：
// boot 同時負責載入狀態、錯誤條的 sink，與派生層清理 watch 的建立。
const boot = useProjectBoot()

// sticky 量測要在最上層建立，子元件用 inject 取用
useStickyOffsets()
// DOM 登錄表也在最上層（契約 F）：面板 / 列 / 條 / 卡片各自登錄，
// 拖曳與捲動對位改查這張表，不再用 DOM 選擇器
const registry = provideDomRegistry()
useClickOutside()
useNow()

// 刪除確認的文案與動作（契約 H）；ConfirmDialog 本身只是外殼。
// v-bind 一次帶進 props 與 onNext / onConfirm / onCancel 三個 emit listener。
const confirmView = useConfirmProps()

/*
 * 首屏外的看板與 Issue 面板延後掛（動畫稽核 K1，規則見 composables/useDeferredPanels.ts）：
 * 只在「從別頁切進來、而且不還原到非 0 的捲動位置」時延後。直接開頁 / 重新整理沒有切頁淡入要保護；
 * 上一頁 / 下一頁回到捲過的位置時，新頁在掛上當下就要是最終高度（spec 7b，router/pageSwap.ts）。
 */
const { kanban: kanbanReady, issues: issuesReady } = provideDeferredPanels(isPageSwapping() && !swapRestoresScroll())

/**
 * 首屏看得到的面板一律同步掛（高螢幕、甘特收合時）：上一個面板的下緣在視窗內，下一個就在同一次更新裡掛上，
 * 第一幀就完整、不會在看得到的地方晚一步冒出來。掛載當下 TopBar 的 measureFit 已經算過版面，這裡讀位置不多花。
 */
function mountVisible(): void {
  if (ui.loadState !== 'ready') return
  const bottomInView = (key: 'gantt' | 'kanban'): boolean => {
    const el = registry.panels.get(key)
    return !!el && el.getBoundingClientRect().bottom < window.innerHeight
  }
  if (!kanbanReady.value) {
    if (bottomInView('gantt')) kanbanReady.value = true
  } else if (!issuesReady.value && bottomInView('kanban')) issuesReady.value = true
}
// 看板掛上後（同一輪的 post）再看 Issue；資料晚到（載入中 → ready）時也重看一次
watch([() => ui.loadState, kanbanReady], mountVisible, { flush: 'post' })

onMounted(() => {
  boot.start()
  void boot.reload()
  mountVisible()
})

// 離開頁面時停掉訂閱，並清掉浮層；否則從總覽回來時上次開著的視窗會自己跳出來
onBeforeUnmount(() => {
  boot.stop()
  ui.resetTransient()
  // 觸發元素記在 useMenus 的模組層（store 不 import composable，所以在這裡清）
  clearMenuAnchors()
})
</script>

<template>
  <div class="dash">
    <TopBar />
    <main class="content">
      <div class="column">
        <!-- 資料還沒到 / 載入失敗時佔住這一欄；TopBar 兩態都留（契約 C） -->
        <LoadingState
          v-if="ui.loadState !== 'ready'"
          :state="ui.loadState"
          :error="ui.loadError"
          @retry="boot.reload()"
        />
        <template v-else>
          <SummaryCards />
          <GanttPanel />
          <KanbanPanel v-if="kanbanReady" />
          <IssuePanel v-if="issuesReady" />
        </template>
      </div>
    </main>

    <!-- 全域浮層；由下往上疊：詳細視窗 170/180 → 選單與對話框 190/200 → Lightbox 300 -->
    <DetailModal />
    <OptionMenu />
    <RowActionMenu />
    <DatePicker />
    <DependencyEditor />
    <!-- 確認框由這裡的 v-if 卸載，離場過渡要包在這一層（包在元件裡面不會跑） -->
    <Transition name="dialog">
      <ConfirmDialog v-if="confirmView" v-bind="confirmView" />
    </Transition>
    <ImageLightbox />
  </div>
</template>

<style scoped>
.dash {
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
