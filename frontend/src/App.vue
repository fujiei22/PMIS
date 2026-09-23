<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <!-- 切頁過渡（A29）：舊頁淡出後新頁才淡入，兩頁不會同時佔版面 -->
  <RouterView v-slot="{ Component }">
    <Transition name="ov-view" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
</template>

<style>
/* 暫放：Task 6 建好 overview-motion.css 後刪掉這段，改由那裡定義 */
.ov-view-enter-active,
.ov-view-leave-active {
  transition: opacity var(--t-base) var(--ease);
}

.ov-view-enter-from,
.ov-view-leave-to {
  opacity: 0;
}
</style>
