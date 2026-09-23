import { API_ERROR_TEXT, apiErrorCode } from '@/constants/dashboard'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

export interface PortfolioBoot {
  /** 載入專案摘要並維護 `overview.loadState` / `loadError`；失敗不 throw。 */
  reload: () => Promise<void>
}

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
      ov.loadState = 'ready'
    } catch (error) {
      console.error('[api]', '載入專案清單', error)
      ov.loadError = API_ERROR_TEXT[apiErrorCode(error)]
      ov.loadState = 'error'
    }
  }

  return { reload }
}
