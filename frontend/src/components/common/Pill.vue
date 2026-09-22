<script setup lang="ts">
// 卡片上「小標 + 值 + ▼」的灰底膠囊（時程 / 完成日期 / 期限 / 解決日期都是這個形狀）。
// legacy 對照：看板卡片 :601-618、Issue 卡片 :730-739。
withDefaults(
  defineProps<{
    /** 膠囊左邊的小標；不給就只顯示值。 */
    label?: string
    /** 右邊要不要畫 ▼（代表點了會開選單）。 */
    caret?: boolean
    /** 可點：加 cursor 與 hover 效果。 */
    clickable?: boolean
    /** 原生 title。 */
    title?: string
  }>(),
  { caret: false, clickable: false },
)
</script>

<template>
  <span class="pill" :class="{ clickable }" :title="title">
    <span v-if="label" class="pill-label">{{ label }}</span>
    <span class="pill-value"><slot /></span>
    <span v-if="caret" class="pill-caret">▼</span>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  height: 22px;
  padding: 0 var(--sp-4) 0 7px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  min-width: 0;
  transition:
    filter var(--t-fast) ease,
    box-shadow var(--t-fast) ease;
}

.clickable {
  cursor: pointer;
}

.clickable:hover {
  filter: var(--hover-dim);
  box-shadow: var(--ring-node);
}

.pill-label {
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  color: var(--text-placeholder);
  letter-spacing: 0.04em;
  flex: 0 0 auto;
}

.pill-value {
  font-size: var(--fs-date);
  font-family: var(--font-mono);
  white-space: nowrap;
  min-width: 0;
}

.pill-caret {
  font-size: var(--fs-7-5);
  color: var(--text-placeholder);
  flex: 0 0 auto;
}
</style>
