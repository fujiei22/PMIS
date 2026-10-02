import { API_ERROR_TEXT, apiErrorCode } from '@/constants/api'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

export interface PortfolioBoot {
  /**
   * 載入專案摘要並維護 `overview.loadState` / `loadError`；失敗不 throw。
   * 切頁時 router 已經先開始載（`preloadPortfolio`）的話，沿用那一發、不再打。
   */
  reload: () => Promise<void>
}

/**
 * 請求序號放在模組層：每次進總覽都會重新呼叫 `usePortfolioBoot()`，
 * 放在函式裡的話，上一次掛載還在飛的請求看不到這一次的序號。
 * 成功的每一發都能把畫面切成 ready（資料已經由 store 套上）；
 * 失敗只有最後一發、而且畫面上還沒有資料時才切成錯誤，較舊的一發晚失敗不影響畫面。
 */
let reloadSeq = 0

/**
 * 切頁時 router 先開始的那一發（`preloadPortfolio`），等頁面掛載時的 `reload()` 取走。
 * 取走就清掉，所以同一次進頁只會打一次：之後的 `reload()`（按重試）才會再打。
 */
let preloaded: Promise<void> | null = null

/**
 * 回到總覽時要看到最新資料、但畫面不能閃（spec 7b）：
 * - 還沒有資料（idle / loading / error）→ 顯示載入中，失敗顯示重試。
 * - 已經有資料（ready）→ 背景重載，全程維持 ready；資料到了就地更新。
 *   背景失敗不蓋掉畫面，只記 console——舊資料仍然可用。
 */
async function load(): Promise<void> {
  const ov = useOverviewStore()
  const pf = usePortfolioStore()
  const ticket = ++reloadSeq
  if (ov.loadState === 'ready') {
    try {
      await pf.load()
    } catch (error) {
      console.error('[api]', '載入專案清單（背景）', error)
    }
    return
  }

  ov.loadState = 'loading'
  ov.loadError = null
  try {
    await pf.load()
    // 不等還在飛的後一發：它之後若失敗，這份資料照樣可用
    ov.loadState = 'ready'
    ov.loadError = null
  } catch (error) {
    console.error('[api]', '載入專案清單', error)
    // 已經有更新的一發在處理，或較早的一發已經把資料帶回來，這一發的失敗就不影響畫面
    if (ticket !== reloadSeq || ov.loadState === 'ready') return
    ov.loadError = API_ERROR_TEXT[apiErrorCode(error)]
    ov.loadState = 'error'
  }
}

/**
 * 切頁進總覽時由 router 守衛呼叫（G16 / C13）：導航一開始就打，不等新頁掛上、也不阻塞導航。
 * out-in 過渡裡舊頁淡出的這段時間資料就到了，第一次進總覽掛上時已經是 ready，不閃「載入中」。
 * 每次導航都覆寫：上一次導航被打斷而沒被取走的那一發，不會留給下一次進頁。
 */
export function preloadPortfolio(): void {
  preloaded = load()
}

/**
 * 總覽的啟動層：把資料層接上畫面（比照 `useProjectBoot`，契約 E）。
 * 總覽不訂閱事件，所以只負責載入狀態。
 */
export function usePortfolioBoot(): PortfolioBoot {
  function reload(): Promise<void> {
    // 掛載時沿用 router 先開始的那一發（進行中或已完成都一樣），不再多打
    const p = preloaded
    preloaded = null
    return p ?? load()
  }

  return { reload }
}
