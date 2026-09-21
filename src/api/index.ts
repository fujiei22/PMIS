import { createMockApi } from '@/api/mock'
import type { MockApi, ProjectApi } from '@/api/types'
import { sampleProject } from '@/mocks/sampleProject'
import type { ProjectData } from '@/types/models'

/**
 * 資料進出的唯一入口。store 與元件一律 `import { api } from '@/api'`，
 * 不直接碰 `@/api/mock`，更不碰 `@/mocks/*`——換後端就只改這支檔案。
 *
 * 選實作：`VITE_API` 未設或 `'mock'` 用記憶體 mock；其他值目前直接丟錯（真實作在 R6 之後）。
 */
const impl = import.meta.env.VITE_API ?? 'mock'

if (impl !== 'mock') {
  throw new Error(`VITE_API=${impl} 的 api 實作尚未實作；目前只支援 'mock'`)
}

/** mock 專用鉤子（failNext / setLatency / reset / emit）。 */
export const mockApi: MockApi = createMockApi(sampleProject)

/** 給 store 與元件用的介面；跟 `mockApi` 是同一個實例，只是型別收窄成契約。 */
export const api: ProjectApi = mockApi

// e2e 要能注入失敗與延遲；只在 dev build 掛上去，production build 不帶這個把手。
if (import.meta.env.DEV) window.__mockApi = mockApi

/**
 * @deprecated 舊的 `@/api/project` 相容匯出，R2 把 `DashboardView` 的載入改成走 store 之後移除。
 */
export async function loadProject(): Promise<ProjectData> {
  return api.loadProject()
}
