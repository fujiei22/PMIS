import { API_ERROR_TEXT, apiErrorCode } from '@/constants/dashboard'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

export interface PortfolioBoot {
  /** 載入專案摘要並維護 `overview.loadState` / `loadError`；失敗不 throw。 */
  reload: () => Promise<void>
}

/**
 * 請求序號放在模組層：每次進總覽都會重新呼叫 `usePortfolioBoot()`，
 * 放在函式裡的話，上一次掛載還在飛的請求看不到這一次的序號。
 * 只有最後一發能改 loadState / loadError；較舊的一發晚失敗，不會把已經 ready 的畫面切成錯誤。
 */
let reloadSeq = 0

/**
 * 總覽的啟動層：把資料層接上畫面（比照 `useProjectBoot`，契約 E）。
 * 總覽不訂閱事件，所以只負責載入狀態。
 *
 * 回到總覽時要看到最新資料、但畫面不能閃（spec 7b）：
 * - 還沒有資料（idle / loading / error）→ 顯示載入中，失敗顯示重試。
 * - 已經有資料（ready）→ 背景重載，全程維持 ready；資料到了就地更新。
 *   背景失敗不蓋掉畫面，只記 console——舊資料仍然可用。
 */
export function usePortfolioBoot(): PortfolioBoot {
  const ov = useOverviewStore()
  const pf = usePortfolioStore()

  async function reload(): Promise<void> {
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
      if (ticket === reloadSeq) ov.loadState = 'ready'
    } catch (error) {
      console.error('[api]', '載入專案清單', error)
      // 已經有更新的一發在處理（或已成功），這一發的失敗就不影響畫面
      if (ticket !== reloadSeq) return
      ov.loadError = API_ERROR_TEXT[apiErrorCode(error)]
      ov.loadState = 'error'
    }
  }

  return { reload }
}
