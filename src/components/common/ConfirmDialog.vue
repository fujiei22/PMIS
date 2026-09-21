<script setup lang="ts">
// 兩步刪除確認的外殼：純展示（契約 H），只認 props、只發事件。
// 文案怎麼組、確認後要刪什麼，都在 composables/useConfirmProps.ts。
// legacy 對照：模板 :1385-1535（四份同構的 sc-if）。
defineProps<{
  open: boolean
  /** 1 = 第一步說明、2 = 再次確認（標題轉紅、動作鈕變實心紅）。 */
  step: 1 | 2
  title: string
  body: string
  /** 內文之外的補充行，沒給就不畫。 */
  extra?: string
  confirmLabel: string
}>()

defineEmits<{
  /** 第一步的動作鈕：往第二步。 */
  next: []
  /** 第二步的動作鈕：真的執行。 */
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div v-if="open" class="confirm-backdrop">
    <div class="confirm-dialog" role="dialog" aria-modal="true">
      <div class="confirm-title" :class="{ final: step === 2 }">{{ title }}</div>
      <div class="confirm-body">{{ body }}</div>
      <div v-if="extra" class="confirm-extra">{{ extra }}</div>
      <div class="confirm-actions">
        <button class="btn-cancel" @click="$emit('cancel')">取消</button>
        <button v-if="step === 1" class="btn-next" @click="$emit('next')">{{ confirmLabel }}</button>
        <button v-else class="btn-danger" @click="$emit('confirm')">{{ confirmLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: var(--sp-10);
  animation: fadeIn var(--t-pop) ease-out;
}

.confirm-dialog {
  width: 100%;
  max-width: 380px;
  background: var(--surface-1);
  border-radius: var(--r-dialog);
  padding: var(--sp-10);
  box-shadow: var(--shadow-modal);
  animation: popIn var(--t-fast) ease-out;
}

.confirm-title {
  font-size: var(--fs-dialog);
  font-weight: var(--fw-bold);
  margin-bottom: var(--sp-4);
}

.confirm-title.final {
  color: var(--danger-text);
}

.confirm-body {
  font-size: var(--fs-month);
  line-height: var(--lh-dialog);
  color: var(--text-3);
}

.confirm-extra {
  margin-top: var(--sp-3);
  font-size: var(--fs-meta);
  line-height: var(--lh-dialog);
  color: var(--text-muted);
}

.confirm-actions {
  display: flex;
  gap: var(--sp-4);
  margin-top: var(--sp-9);
  justify-content: flex-end;
}

.confirm-actions button {
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-month);
  border-radius: var(--r-input);
  cursor: pointer;
}

.btn-cancel {
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  color: var(--text-2);
}

.btn-next {
  border: 1px solid var(--danger-bd);
  background: var(--danger-bg);
  color: var(--danger);
  font-weight: var(--fw-medium);
}

.btn-danger {
  border: 1px solid var(--danger);
  background: var(--danger);
  color: var(--surface-1);
  font-weight: var(--fw-medium);
}
</style>
