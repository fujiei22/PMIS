<script setup lang="ts">
// 寫入失敗的提示條：掛在 TopBar 的 <header> 第二列（契約 C、review M11）。
// 主文是操作名稱、副文是錯誤碼對應的固定中文；server 原文只進 console（review M2）。
import { computed } from 'vue'
import { API_ERROR_TEXT } from '@/constants/dashboard'
import { useUiStore } from '@/stores/ui'

/** 畫面最多列幾筆，其餘收成「還有 N 筆」。契約 C */
const MAX_SHOWN = 3

const ui = useUiStore()
const shown = computed(() => ui.errors.slice(0, MAX_SHOWN))
const rest = computed(() => Math.max(0, ui.errors.length - MAX_SHOWN))
</script>

<template>
  <!-- 不自動關閉：使用者自己按 ✕（契約 C） -->
  <div v-if="ui.errors.length" class="error-bar" role="alert" data-errorbar>
    <div v-for="e in shown" :key="e.id" class="error-item">
      <span class="error-label">{{ e.label }}</span>
      <span class="error-code">{{ API_ERROR_TEXT[e.code] }}</span>
      <span v-if="e.count > 1" class="error-count">×{{ e.count }}</span>
      <span class="error-x" role="button" title="關閉" @click="ui.dismissError(e.id)">✕</span>
    </div>
    <div v-if="rest" class="error-rest">還有 {{ rest }} 筆</div>
  </div>
</template>

<style scoped>
.error-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-10) var(--sp-4);
  animation: popIn var(--t-pop) ease-out;
}

.error-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 26px;
  padding: 0 var(--sp-4) 0 var(--sp-5);
  font-size: var(--fs-control);
  border: 1px solid var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger-text);
  border-radius: var(--r-control);
}

.error-label {
  font-weight: var(--fw-medium);
}

.error-code {
  color: var(--danger);
  opacity: 0.85;
}

.error-count {
  font-family: var(--font-mono);
}

.error-x {
  cursor: pointer;
  padding: 0 var(--r-2);
  opacity: 0.7;
}

.error-x:hover {
  opacity: 1;
}

.error-rest {
  font-size: var(--fs-control);
  color: var(--danger-text);
}
</style>
