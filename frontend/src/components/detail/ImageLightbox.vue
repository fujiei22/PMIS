<script setup lang="ts">
// 圖片附件的全螢幕預覽；點任何地方關閉。legacy 對照：模板 :1294-1302、lightbox :3922-3931。
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <div v-if="ui.lightbox" class="lightbox" role="button" @click="ui.lightbox = null">
    <img v-if="ui.lightbox.url" :src="ui.lightbox.url" :alt="ui.lightbox.name" />
    <div class="caption">
      <span>{{ ui.lightbox.name }}</span>
      <span class="size">{{ ui.lightbox.size }}</span>
    </div>
  </div>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: var(--backdrop-lightbox);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-6);
  padding: 32px;
  cursor: zoom-out;
  animation: fadeIn 0.15s ease-out;
}

.lightbox img {
  max-width: 90vw;
  max-height: 80vh;
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lightbox);
  display: block;
}

.caption {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  color: var(--text-on-dark);
  font-size: 12.7px;
}

.size {
  font-family: var(--font-mono);
  color: var(--text-placeholder);
}
</style>
