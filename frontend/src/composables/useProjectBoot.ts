import { API_ERROR_TEXT, apiErrorCode } from '@/constants/dashboard'
import { setErrorSink } from '@/stores/_optimistic'
import { useProjectSync } from '@/stores/_sync'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

export interface ProjectBoot {
  /** 開始收後端事件（`DashboardView` onMounted）。 */
  start: () => void
  /** 停止收事件（onBeforeUnmount）。 */
  stop: () => void
  /** 載入整包資料並維護 `ui.loadState` / `ui.loadError`；失敗不 throw。 */
  reload: () => Promise<void>
}

/**
 * 啟動層：把資料層接上畫面（契約 E）。
 *
 * 資料 store 不認識派生層，所以這三件事都在這裡做：
 * 1. 注入 error sink——`runOptimistic` 失敗時把錯誤送進 `ui.errors`。
 * 2. `loadState` / `loadError`——`taskStore.load()` 只負責回 Promise。
 * 3. 先把 selection / ui 建起來，它們的懸空 id 清理 `watch` 要在資料進來前掛好。
 *
 * `DashboardView` 是唯一的呼叫端（事件訂閱也只有這一處，review M6）。
 */
export function useProjectBoot(): ProjectBoot {
  const ui = useUiStore()
  const taskStore = useTaskStore()
  // 建立即掛上清理 watch（契約 E）
  useSelectionStore()
  setErrorSink((e) => ui.pushError(e))

  const sync = useProjectSync()

  async function reload(): Promise<void> {
    ui.loadState = 'loading'
    ui.loadError = null
    try {
      await taskStore.load()
      ui.loadState = 'ready'
    } catch (error) {
      console.error('[api]', '載入專案', error)
      ui.loadError = API_ERROR_TEXT[apiErrorCode(error)]
      ui.loadState = 'error'
    }
  }

  return { start: sync.start, stop: sync.stop, reload }
}
