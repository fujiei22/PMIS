import { createMockApi } from '@/api/mock'
import type { MockApi, ProjectApi } from '@/api/types'

/**
 * 資料進出的唯一入口。store 與元件一律 `import { api } from '@/api'`，
 * 不直接碰 `@/api/mock`，更不碰 `@/mocks/*`——換後端就只改這支檔案。
 *
 * 選實作：`VITE_API` 未設、空字串或 `'mock'` 用記憶體 mock；
 * 其他值目前丟錯（真實作在 R6 之後，規劃放 `src/api/http/index.ts`）。
 */
export interface ApiBundle {
  api: ProjectApi
  /** 只有 mock 實作才有的測試鉤子；接了真後端就是 undefined。 */
  mock?: MockApi
}

/**
 * 依 `VITE_API` 挑實作。
 *
 * review F11：判斷與丟錯都收在函式裡，不在模組頂層——頂層 throw 的模組
 * 沒辦法在測試裡換環境變數重載，錯誤也會變成難讀的模組初始化失敗。
 * 空字串（`VITE_API=` 或 `.env` 留空）視同沒設，不然會掉進「未知實作」分支。
 */
export function createApi(): ApiBundle {
  const impl = import.meta.env.VITE_API || 'mock'
  if (impl === 'mock') {
    const mock = createMockApi()
    return { api: mock, mock }
  }
  throw new Error(`VITE_API=${impl} 的 api 實作尚未實作；目前只支援 'mock'`)
}

const selected = createApi()

/**
 * mock 專用鉤子（failNext / setLatency / reset / emit）。
 * review F11：接了真後端就是 undefined，型別上要逼呼叫端面對這件事；
 * 測試裡確定走 mock，用 `mockApi!` 收窄。
 */
export const mockApi: MockApi | undefined = selected.mock

/** 給 store 與元件用的介面；走 mock 時跟 `mockApi` 是同一個實例。 */
export const api: ProjectApi = selected.api

// e2e 要能注入失敗與延遲；只在 dev build 掛上去，production build 不帶這個把手。
if (import.meta.env.DEV && mockApi) window.__mockApi = mockApi
