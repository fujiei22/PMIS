import { createRouter, createWebHistory } from 'vue-router'
import { preloadPortfolio } from '@/composables/usePortfolioBoot'
import { preloadProject } from '@/composables/useProjectBoot'
import { loginLocation } from '@/composables/useSession'
import { waitForPageSwap } from '@/router/pageSwap'
import { useSessionStore } from '@/stores/session'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import ProjectsOverviewView from '@/views/ProjectsOverviewView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** 不用登入就能進（登入頁）。沒標的一律要登入，登入守衛會導到登入頁。 */
    public?: boolean
  }
}

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
      // 登入頁；登入後回到 ?redirect= 的原路徑（沒有就回總覽）
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true },
    },
    {
      // 單一專案的 Dashboard，依 `id` 載入（api.loadProject(id)）；
      // mock 只有一份完整專案，任何 id 都回它
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
   * 會還原到非 0 的位置時告訴 pageSwap：新頁就不能延後掛任何東西（K1，見 composables/useDeferredPanels.ts）。
   */
  scrollBehavior: async (to, from, saved) => {
    if (from.matched.length && to.path !== from.path) {
      await waitForPageSwap(undefined, !!saved && (saved.top > 0 || saved.left > 0))
    }
    return saved ?? { top: 0 }
  },
})

/*
 * 登入守衛：沒登入的導航導到登入頁（`?redirect=` 帶原路徑，登入後回去）。
 *
 * **必須註冊在下面的先載守衛之前**（守衛依註冊順序執行）：被導去登入頁的導航不會先打出要登入的請求。
 * 只有第一次導航（或登出 / 401 重置之後）問後端（`session.load()` → `api.getSession()`），
 * 之後的導航直接看 store，切頁不多等一發。問不到（連不上）就當沒登入、到登入頁，下次導航再問。
 */
router.beforeEach(async (to) => {
  const session = useSessionStore()
  if (!session.checked) {
    try {
      await session.load()
    } catch (error) {
      console.error('[api]', '確認登入狀態', error)
    }
  }
  if (to.meta.public || session.info) return true
  return loginLocation(to.fullPath)
})

/*
 * G16 / C13：切頁一開始就先載目標頁的資料，不等新頁掛上、也不阻塞導航（守衛不 await）。
 * 只對總覽與 Dashboard 先載；登入頁不載任何東西（登入守衛已經擋掉沒登入的導航）。
 * out-in 過渡裡舊頁淡出的這段時間資料就在路上，新頁掛上時多半已經 ready，不閃「載入中」。
 *
 * 同一次進頁只打一次 load（e2e 的 failNext 只擋一發，靠這個維持語意）：
 * - 這裡開始的那一發放在 boot 模組裡，頁面掛載時 `reload()` 取走沿用（進行中或已完成都一樣），取走就清掉；
 *   之後按重試才會再打。
 * - 頁面重掛 ⇔ path 變了（App.vue 的 key 是 route.path），所以只在 path 變時先載；
 *   只換 hash / query 不重掛頁面，也就不會有 reload 來取，不先載。
 * - 初始導航（直接開頁、重新整理）也經過這裡：from 是 START_LOCATION，它的 path 也是 '/'，
 *   直接開總覽時 path 沒變，所以用 matched 是否為空判斷，跟 scrollBehavior 一樣。
 * - 導航被後來的導航打斷時，這一發不會被取走；下一次進同一頁的導航會覆寫它，不會沿用到舊的。
 *
 * 專案 id 傳給 `preloadProject`，一路傳到 `api.loadProject(id)`；換了專案先清空、不走背景重載
 * （見 useProjectBoot 的 `loadedId`）。
 */
router.beforeEach((to, from) => {
  if (from.matched.length && to.path === from.path) return
  if (to.name === 'overview') preloadPortfolio()
  else if (to.name === 'dashboard') preloadProject(String(to.params.id))
})

export default router
