import { useRouter, type RouteLocationRaw, type Router } from 'vue-router'
import { resetPortfolioBoot } from '@/composables/usePortfolioBoot'
import { resetProjectBoot } from '@/composables/useProjectBoot'
import { setErrorSink } from '@/stores/_optimistic'
import { useCommentStore } from '@/stores/comment'
import { useFilterStore } from '@/stores/filter'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSelectionStore } from '@/stores/selection'
import { useSessionStore } from '@/stores/session'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 把前端回到剛開網頁的樣子：登出、登入失效（401）、換使用者之後，下一位不能看到上一位的任何東西。
 *
 * 不清的話，下一位進頁時是「背景重載」（`loadState` 還是 ready），畫面會先秀上一位的資料、
 * 沿用上一位的篩選與選取，上一位還在飛的請求晚回來也會灌進來。所以這裡：
 * - 資料層全部清空（task / issue / comment / member / budget / project / portfolio / session），
 *   還在飛的載入一律作廢（各 store 的序號）。
 * - 派生層（selection / filter / ui / overview）整個回初始值，連排序、縮放、面板收合、總覽檢視這些
 *   平常跨路由保留的偏好也清（那是上一位的）；兩個 `loadState` 回 idle。
 * - 兩個 boot 模組的模組層狀態（先載的那一發、store 裡是哪個專案）歸零。
 * - 錯誤條的出口拿掉：上一位還在飛的寫入失敗只進 console，不會出現在下一位的錯誤條（Dashboard 掛載時會再接上）。
 *
 * 時鐘層（`clock`）不動：時間跟誰登入無關。
 *
 * **新增 store 或 store 欄位時**：這裡要清得到它（通常是該 store 的 `reset()`）。
 * `composables/__tests__/useSession.spec.ts` 會檢查重置後每個 store 都等於全新 pinia 的初始狀態，漏了就紅。
 *
 * 呼叫時機：登入頁掛上時（`views/LoginView.vue`）。登出與 401 都會導到登入頁，那時舊頁已經淡出卸載，
 * 清空不會讓正在淡出的舊頁先閃成「載入中」。
 */
export function resetSession(): void {
  resetProjectBoot()
  resetPortfolioBoot()
  setErrorSink(null)
  // 資料層：taskStore.reset() 連 member / issue / comment / budget / project 一起清
  useTaskStore().reset()
  usePortfolioStore().reset()
  useSessionStore().clear()
  // 留言的頁籤與檔案檢視是畫面狀態（README〈誰可以寫哪些欄位〉：可以直接寫），換專案時刻意保留，登出時回預設
  const comment = useCommentStore()
  comment.tab = 'comments'
  comment.fileView = 'icon'
  // 派生層
  useSelectionStore().reset()
  useFilterStore().reset()
  useUiStore().reset()
  useOverviewStore().reset()
}

/** 登入頁的位置；原路徑是首頁（或沒有）就不帶 `redirect`，登入後本來就回首頁。 */
export function loginLocation(from?: string): RouteLocationRaw {
  return from && from !== '/' ? { name: 'login', query: { redirect: from } } : { name: 'login' }
}

/**
 * 登入失效（api 層的 401 通知，`main.ts` 用 `onUnauthorized` 註冊）：記成沒登入、導到登入頁，登入後回原頁。
 * 已經在登入頁（例：舊頁還在飛的請求晚回來）就只記成沒登入、不再導。
 * 整頁重置在登入頁掛上時做（見 `resetSession`）。
 */
export function expireSession(router: Router): void {
  useSessionStore().clear()
  const current = router.currentRoute.value
  if (current.meta.public) return
  void router.replace(loginLocation(current.fullPath))
}

export interface Session {
  /** 登出：通知後端（失敗也照樣登出）後導到登入頁；整頁重置在登入頁掛上時做。 */
  logout: () => Promise<void>
}

/** 給元件用的登入動作（總覽頂欄的登入者選單）。要在 setup 裡呼叫（用到 `useRouter`）。 */
export function useSession(): Session {
  const router = useRouter()
  const session = useSessionStore()

  async function logout(): Promise<void> {
    await session.logout()
    await router.push({ name: 'login' })
  }

  return { logout }
}
