<script setup lang="ts">
// 總覽的下拉外殼：觸發鈕 ＋ 彈出面板；開關狀態由使用端（overview store）持有，本元件只 emit。
import { ref } from 'vue'
import { useDismiss } from '@/composables/useDismiss'

const props = defineProps<{
  /** 觸發鈕文字，例如「狀態」或「狀態 2」。 */
  label: string
  /** 有勾選條件時為 true，觸發鈕轉 accent 色。 */
  active: boolean
  /** 面板是否開著。 */
  open: boolean
  /** 資料還沒到時整顆停用。 */
  disabled?: boolean
  /** 面板寬度（CSS 長度，例如 '300px'）；不給就依內容撐開、最小 150px。 */
  menuWidth?: string
  /** 觸發鈕的 aria-label；內容換成頭像疊這類沒有文字的情況要給。 */
  ariaLabel?: string
}>()

const emit = defineEmits<{
  toggle: []
  close: []
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)

useDismiss(
  root,
  () => props.open,
  () => emit('close'),
  trigger,
)
</script>

<template>
  <div ref="root" class="dd" :class="{ 'is-open': open }">
    <button
      ref="trigger"
      type="button"
      class="dd-trigger"
      :class="{ active }"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      :disabled="disabled"
      @click="emit('toggle')"
    >
      <slot name="trigger">
        <span>{{ label }}</span>
      </slot>
      <span class="dd-arrow" aria-hidden="true">▼</span>
    </button>
    <!-- 進出場用 base.css 的 pop（transition：開到一半收合從當下往回、離場不攔點擊；動畫稽核 T12） -->
    <Transition name="pop">
      <div v-if="open" class="dd-menu" :style="menuWidth ? { width: menuWidth } : undefined">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  flex: 0 0 auto;
}

.dd-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  height: var(--ctrl-h);
  padding: 0 var(--sp-6);
  font: inherit;
  font-size: var(--fs-control);
  border: 1px solid var(--border-1);
  border-radius: var(--r-pill);
  color: var(--text-2);
  background: var(--surface-1);
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

/* hover 只給有滑鼠的裝置：觸控點一下後 :hover 會一直黏著，直到點別的地方（本檔其他 hover 同理） */
@media (hover: hover) {
  .dd-trigger:hover:not(:disabled) {
    background: var(--surface-3);
  }
}

.dd-trigger.active {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.dd-trigger:disabled {
  cursor: default;
  color: var(--text-placeholder);
}

.dd-trigger:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.dd-arrow {
  display: inline-block;
  font-size: var(--fs-weekday);
  color: var(--text-muted);
  transition: transform var(--t-layout) var(--ease);
}

.dd.is-open .dd-arrow {
  transform: rotate(180deg);
}

/*
 * 右緣對齊、往左展開：總覽頂欄的篩選器一律靠右排（.top-right / .filters 都是 flex-end），
 * 觸發鈕變寬 / 變窄（勾了選項，「狀態」→「狀態 1」、頭像疊增減）是左緣在動、右緣不動；
 * 錨在左緣的話開著勾選項選單會被帶著橫移（動畫稽核 T6：狀態 −10px、成員 +30px）。
 */
.dd-menu {
  position: absolute;
  top: calc(var(--ctrl-h) + var(--sp-1));
  right: 0;
  z-index: 100;
  min-width: 150px;
  padding: var(--sp-2);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-menu);
}

/* 選項樣式給 slot 內容用（頂欄狀態 / 需注意下拉）；勾選態認 .on 或 aria-pressed，使用端擇一即可 */
.dd-menu :deep(.dd-item) {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  width: 100%;
  height: var(--dd-item-h);
  padding: 0 var(--sp-4);
  border: 0;
  border-radius: var(--r-control);
  background: transparent;
  font: inherit;
  font-size: var(--fs-control);
  color: var(--text-2);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}

.dd-menu :deep(.dd-item.on),
.dd-menu :deep(.dd-item[aria-pressed='true']) {
  color: var(--accent-hover);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

@media (hover: hover) {
  .dd-menu :deep(.dd-item:hover) {
    background: var(--surface-3);
  }

  .dd-menu :deep(.dd-item.on:hover),
  .dd-menu :deep(.dd-item[aria-pressed='true']:hover) {
    background: var(--accent-tint-2);
  }
}

.dd-menu :deep(.dd-item:focus-visible) {
  outline: none;
  box-shadow: var(--ring-focus);
}

.dd-menu :deep(.dd-dot) {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
}

.dd-menu :deep(.dd-label) {
  flex: 1;
}

/* 勾選框：用 opacity 而非 visibility 切換，才有淡入淡出（A6） */
.dd-menu :deep(.dd-check) {
  width: 1ch;
  font-size: var(--fs-pill);
  color: var(--accent);
  text-align: right;
  transition: opacity var(--t-fast) var(--ease);
}

.dd-menu :deep(.dd-item:not(.on, [aria-pressed='true']) .dd-check) {
  opacity: 0;
}
</style>
