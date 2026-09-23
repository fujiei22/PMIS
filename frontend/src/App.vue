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
