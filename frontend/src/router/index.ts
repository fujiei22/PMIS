import { createRouter, createWebHistory } from 'vue-router'
import { waitForPageSwap } from '@/router/pageSwap'
import DashboardView from '@/views/DashboardView.vue'
import ProjectsOverviewView from '@/views/ProjectsOverviewView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      // 首頁是所有專案總覽（spec 目標 1）
      path: '/',
      name: 'overview',
      component: ProjectsOverviewView,
    },
    {
      // 單一專案的 Dashboard。`id` 目前不影響載入（mock 只有一份完整專案），
      // 等後端接上後才依 id 取資料
      path: '/projects/:id',
      name: 'dashboard',
      component: DashboardView,
    },
    // 打錯的網址一律導回總覽，不做 404 頁
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  /*
   * spec 7b：上一頁 / 下一頁回到原本的捲動位置，其餘切頁回頂端。
   * 換頁時要等新頁掛上才捲（見 pageSwap.ts）：切頁過渡是 out-in，太早捲會套在正在離開的舊頁上。
   * 同一頁只換 hash（總覽的 #timeline）不會換頁，不必等。
   */
  scrollBehavior: async (to, from, saved) => {
    if (from.matched.length && to.path !== from.path) await waitForPageSwap()
    return saved ?? { top: 0 }
  },
})

export default router
