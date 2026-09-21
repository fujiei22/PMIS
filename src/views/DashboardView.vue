<script setup lang="ts">
// Dashboard 主畫面：載資料、組頂部列 + 摘要卡 + 三個面板，並掛全域的點擊外部與時鐘。
import { onMounted } from 'vue'
import { loadProject } from '@/api/project'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import OptionMenu from '@/components/common/OptionMenu.vue'
import GanttPanel from '@/components/gantt/GanttPanel.vue'
import IssuePanel from '@/components/issues/IssuePanel.vue'
import KanbanPanel from '@/components/kanban/KanbanPanel.vue'
import TopBar from '@/components/layout/TopBar.vue'
import SummaryCards from '@/components/summary/SummaryCards.vue'
import { useClickOutside } from '@/composables/useClickOutside'
import { useNow } from '@/composables/useNow'
import { useStickyOffsets } from '@/composables/useStickyOffsets'
import { useTaskStore } from '@/stores/task'

// 資料只從這裡進來一次：api → taskStore.load() 再分給其他 store。
const taskStore = useTaskStore()

// sticky 量測要在最上層建立，子元件用 inject 取用
useStickyOffsets()
useClickOutside()
useNow()

onMounted(async () => {
  taskStore.load(await loadProject())
})
</script>

<template>
  <div class="dash">
    <TopBar />
    <main class="content">
      <div class="column">
        <SummaryCards />
        <GanttPanel />
        <KanbanPanel />
        <IssuePanel />
      </div>
    </main>

    <!-- 全域浮層：選項選單、日期選擇器、刪除確認（詳細視窗與相依編輯器在 S6） -->
    <OptionMenu />
    <DatePicker />
    <ConfirmDialog />
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
