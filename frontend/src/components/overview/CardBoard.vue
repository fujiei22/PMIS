<script setup lang="ts">
// 卡片檢視：「專案看板」面板，每位 PM 一條橫向泳道；篩掉全部時面板照留，內容換成空狀態。
import OvEmpty from '@/components/overview/OvEmpty.vue'
import OvPanel from '@/components/overview/OvPanel.vue'
import OvSortControls from '@/components/overview/OvSortControls.vue'
import PmLane from '@/components/overview/PmLane.vue'
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
      <!-- PM 泳道的進出與重排（A9）；離場的泳道由 freezeLeave 釘在原位 -->
      <TransitionGroup
        v-if="overview.groups.length"
        name="ov-col"
        tag="div"
        class="board"
        @before-leave="freezeLeave"
      >
        <PmLane v-for="group in overview.groups" :key="group.pm.id" :group="group" />
      </TransitionGroup>
      <OvEmpty v-else />
    </Transition>
  </OvPanel>
</template>

<style scoped>
/*
 * 泳道由上往下排。position: relative 讓 freezeLeave 的 offset 以這裡為基準；
 * 也是 PmLane 窄版切換的容器（@container board）。
 * overflow-anchor: none：頁面已捲動時篩選 / 排序讓泳道換位置，瀏覽器的捲動錨定會同時調整捲動位置，
 * 和泳道 / 卡片的 FLIP 位移疊在一起，卡片會先跳一段再動畫；重排已有動畫帶到新位置，不需要錨定。
 */
.board {
  position: relative;
  overflow-anchor: none;
  container: board / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  padding: var(--sp-6);
  background: var(--surface-2);
  border-radius: 0 0 var(--r-panel) var(--r-panel);
}
</style>
