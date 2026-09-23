<script setup lang="ts">
// 「進入 →」連結：導到該專案的 Dashboard。專案卡與時間軸速覽共用，樣式只寫這一份。
import { RouterLink } from 'vue-router'

defineProps<{
  /** 專案 id。 */
  id: string
}>()
</script>

<template>
  <!-- @click.stop：別讓點擊冒泡到卡片或列，觸發展開切換 -->
  <RouterLink class="btn btn-enter" :to="{ name: 'dashboard', params: { id } }" @click.stop>
    進入 <span aria-hidden="true">→</span>
  </RouterLink>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--ctrl-h);
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  border-radius: var(--r-control);
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.btn-enter {
  margin-left: auto;
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--surface-1);
}

/* 蓋掉 base.css 的 a:hover（變色＋底線） */
.btn-enter:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--surface-1);
  text-decoration: none;
}

.btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
