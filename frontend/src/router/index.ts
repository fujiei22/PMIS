import { createRouter, createWebHistory } from 'vue-router'
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
  // spec 7b：上一頁 / 下一頁回到原本的捲動位置，其餘切頁回頂端
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

export default router
