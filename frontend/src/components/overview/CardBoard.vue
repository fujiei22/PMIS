<script setup lang="ts">
// 卡片檢視：「專案看板」面板，每位 PM 一直欄；篩掉全部時面板照留，內容換成空狀態。
import OvEmpty from '@/components/overview/OvEmpty.vue'
import OvPanel from '@/components/overview/OvPanel.vue'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import PmColumn from '@/components/overview/PmColumn.vue'
import { freezeLeave } from '@/composables/freezeLeave'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()
</script>

<template>
  <OvPanel title="專案看板" view="cards">
    <template #head>
      <OvSortControls />
    </template>
    <!-- 有欄 ↔ 空狀態之間淡入淡出（A17） -->
    <Transition name="ov-fade" mode="out-in">
      <!-- PM 欄的進出與重排（A9）；離場的欄由 freezeLeave 釘在原位 -->
      <TransitionGroup
        v-if="overview.groups.length"
        name="ov-col"
        tag="div"
        class="board"
        @before-leave="freezeLeave"
      >
        <PmColumn v-for="group in overview.groups" :key="group.pm.id" :group="group" />
      </TransitionGroup>
      <OvEmpty v-else />
    </Transition>
  </OvPanel>
</template>

<style scoped>
/* position: relative 讓 freezeLeave 的 offset 以這裡為基準 */
.board {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-5);
  align-items: start;
  padding: var(--sp-6);
  background: var(--surface-2);
  border-radius: 0 0 var(--r-panel) var(--r-panel);
}
</style>
