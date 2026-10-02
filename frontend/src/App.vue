<script setup lang="ts">
// 最外層：路由出口與切頁過渡。
// 切頁過渡（A29）是 out-in：舊頁淡出後新頁才淡入，兩頁不會同時佔版面；
// 新頁掛上時通知 router，上一頁的捲動位置才套在新頁上；淡入跑完再通知一次，
// Dashboard 等它才掛首屏外的面板（pageSwap.ts）。
// key 用 route.path：/projects/a 換到 /projects/b 時 Dashboard 會重新掛載、重新載入，
// 同一頁只換 hash 則不重掛。
import { RouterView } from 'vue-router'
import { notifyPageEntered, notifyPageSettled } from '@/router/pageSwap'
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition
      name="page-view"
      mode="out-in"
      @enter="notifyPageEntered"
      @after-enter="notifyPageSettled"
    >
      <component :is="Component" :key="route.path" />
    </Transition>
  </RouterView>
</template>
