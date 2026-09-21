<script setup lang="ts">
// 整包專案資料還沒到（或載入失敗）時，佔住 `.column` 的位置（契約 C、review M11）。
// TopBar 兩種狀態都留著，畫面不會整頁跳掉。
import type { LoadState } from '@/stores/ui'

defineProps<{ state: LoadState; error: string | null }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="load-state" data-loadstate>
    <template v-if="state === 'error'">
      <div class="msg" data-load-error>{{ error ?? '載入失敗' }}</div>
      <button class="btn-danger" @click="emit('retry')">重試</button>
    </template>
    <div v-else class="msg">載入中…</div>
  </div>
</template>

<style scoped>
.load-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-6);
  min-height: 320px;
}

.msg {
  font-size: var(--fs-panel);
  color: var(--text-muted);
}
</style>
