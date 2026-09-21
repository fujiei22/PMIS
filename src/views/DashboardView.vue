<script setup lang="ts">
// Dashboard 主畫面：載資料、組頂部列 + 摘要卡 + 三個面板，並掛全域的點擊外部與時鐘。
import { onBeforeUnmount, onMounted } from 'vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import LoadingState from '@/components/common/LoadingState.vue'
import OptionMenu from '@/components/common/OptionMenu.vue'
import DetailModal from '@/components/detail/DetailModal.vue'
import ImageLightbox from '@/components/detail/ImageLightbox.vue'
import DependencyEditor from '@/components/dialogs/DependencyEditor.vue'
import GanttPanel from '@/components/gantt/GanttPanel.vue'
import IssuePanel from '@/components/issues/IssuePanel.vue'
import KanbanPanel from '@/components/kanban/KanbanPanel.vue'
import TopBar from '@/components/layout/TopBar.vue'
import SummaryCards from '@/components/summary/SummaryCards.vue'
import { useClickOutside } from '@/composables/useClickOutside'
import { useConfirmProps } from '@/composables/useConfirmProps'
import { useNow } from '@/composables/useNow'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { useStickyOffsets } from '@/composables/useStickyOffsets'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
// 資料只從這裡進來一次、後端事件也只在這裡訂閱一次（契約 B / E、review M6）：
// boot 同時負責載入狀態、錯誤條的 sink，與派生層清理 watch 的建立。
const boot = useProjectBoot()

// sticky 量測要在最上層建立，子元件用 inject 取用
useStickyOffsets()
useClickOutside()
useNow()

// 刪除確認的文案與動作（契約 H）；ConfirmDialog 本身只是外殼。
// v-bind 一次帶進 props 與 onNext / onConfirm / onCancel 三個 emit listener。
const confirmView = useConfirmProps()

onMounted(() => {
  boot.start()
  void boot.reload()
})

onBeforeUnmount(() => boot.stop())
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
          <KanbanPanel />
          <IssuePanel />
        </template>
      </div>
    </main>

    <!-- 全域浮層；由下往上疊：詳細視窗 170/180 → 選單與對話框 190/200 → Lightbox 300 -->
    <DetailModal />
    <OptionMenu />
    <DatePicker />
    <DependencyEditor />
    <ConfirmDialog v-if="confirmView" v-bind="confirmView" />
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
