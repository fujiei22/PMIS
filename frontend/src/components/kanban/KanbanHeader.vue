<script setup lang="ts">
// 任務看板每一欄的標題（色點 + 狀態名 + 數量），黏在面板頭之下。
// legacy 對照：模板 :577-581。
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'

defineProps<{ label: string; color: string; count: number }>()

const sticky = useStickyOffsetsContext()
</script>

<template>
  <div class="col-head" :style="{ top: `${sticky.innerTop('kanban')}px` }">
    <div class="dot" :style="{ background: color }"></div>
    <div class="label">{{ label }}</div>
    <div class="count">{{ count }}</div>
  </div>
</template>

<style scoped>
.col-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border-hair);
  position: sticky;
  z-index: 6;
  background: var(--surface-1);
  transform: translateZ(0);
  backface-visibility: hidden;
  border-radius: var(--r-card) var(--r-card) 0 0;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.label {
  font-size: var(--fs-record);
  font-weight: var(--fw-bold);
  color: var(--text-2);
}

.count {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: var(--r-pill);
  padding: 1px 7px;
}
</style>
