<script setup lang="ts">
// Issue 看板每一欄的標題；比看板欄多了長標題截斷（分類名可能很長）。
// legacy 對照：模板 :702-706。
import { useStickyOffsetsContext } from '@/composables/useStickyOffsets'

defineProps<{ label: string; color: string; count: number }>()

const sticky = useStickyOffsetsContext()
</script>

<template>
  <div class="col-head" :style="{ top: `${sticky.innerTop('issues')}px` }">
    <div class="dot" :style="{ background: color }"></div>
    <div class="label" :title="label">{{ label }}</div>
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
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.count {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: var(--r-pill);
  padding: 1px 7px;
}
</style>
