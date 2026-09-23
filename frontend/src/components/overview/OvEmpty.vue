<script setup lang="ts">
// 總覽的空狀態：沒有可顯示的專案，或專案都被篩掉（附「清除篩選」）；卡片與時間軸共用。
// 用「有沒有篩選」判斷而不是「有沒有專案」：專案都找不到 PM 時（groups 空、但 projects 不空），
// 沒篩選卻顯示「清除篩選」會是一顆按了沒反應的按鈕。
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()
</script>

<template>
  <div class="ov-empty" data-testid="overview-empty">
    <template v-if="!overview.anyFilter">
      <span>目前沒有專案</span>
    </template>
    <template v-else>
      <span>沒有符合條件的專案</span>
      <button type="button" class="btn" @click="overview.clearFilters()">清除篩選</button>
    </template>
  </div>
</template>

<style scoped>
.ov-empty {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-6);
  padding: var(--sp-9) var(--sp-10);
  border: 1px dashed var(--border-control);
  border-radius: var(--r-panel);
  color: var(--text-muted);
  font-size: var(--fs-14);
}

.btn {
  display: inline-flex;
  align-items: center;
  min-height: var(--ctrl-h);
  padding: var(--sp-4) var(--sp-7);
  font: inherit;
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  border: 1px solid var(--border-control);
  border-radius: var(--r-control);
  background: var(--surface-1);
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.btn:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
