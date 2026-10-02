<script setup lang="ts">
// 專案狀態 pill：落後 / 需注意 / 進行中 / 未開始 / 已完成，底色＋邊框＋圓點＋文字。
import { BADGE_CLASS, PROJECT_BADGE_LABEL } from '@/constants/overview'
import type { ProjectBadgeKind } from '@/lib/portfolio'

defineProps<{ kind: ProjectBadgeKind }>()
</script>

<template>
  <span class="pill" :class="'pill-' + BADGE_CLASS[kind]"
    ><i class="pill-dot"></i>{{ PROJECT_BADGE_LABEL[kind] }}</span
  >
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  padding: var(--pad-pill);
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  line-height: 1;
  white-space: nowrap;
  /* 背景重載後狀態可能改變，換色時不要硬切 */
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.pill-dot {
  width: var(--r-badge);
  height: var(--r-badge);
  border-radius: 50%;
  background: currentColor;
}

.pill-late {
  color: var(--danger-text);
  background: var(--danger-bg);
  border-color: var(--danger-bd);
}

.pill-late .pill-dot {
  background: var(--st-delayed-dot);
}

/* 「需注意」沿用 --st-paused-* 色系，class 叫 paused（見 BADGE_CLASS） */
.pill-paused {
  color: var(--ist-paused-fg);
  background: var(--ist-paused-bg);
  border-color: var(--ist-paused-bd);
}

.pill-paused .pill-dot {
  background: var(--st-paused-dot);
}

.pill-doing {
  color: var(--ist-doing-fg);
  background: var(--ist-doing-bg);
  border-color: var(--ist-doing-bd);
}

.pill-doing .pill-dot {
  background: var(--st-doing-dot);
}

/* B2 沒有未開始的樣式，比照 Issue「未處理」的灰階補上 */
.pill-todo {
  color: var(--ist-open-fg);
  background: var(--ist-open-bg);
  border-color: var(--ist-open-bd);
}

.pill-todo .pill-dot {
  background: var(--st-todo-dot);
}

.pill-done {
  color: var(--success-text);
  background: var(--success-bg);
  border-color: var(--success-bd);
}

.pill-done .pill-dot {
  background: var(--st-done-dot);
}
</style>
