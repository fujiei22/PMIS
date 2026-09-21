/// <reference types="vite/client" />

import type { MockApi } from '@/api/types'

declare global {
  interface ImportMetaEnv {
    /** 要用哪個 api 實作；未設或 'mock' 走記憶體 mock（見 src/api/index.ts）。 */
    readonly VITE_API?: string
  }

  interface Window {
    /** dev build 才有：e2e 用它注入失敗與延遲（`src/api/index.ts`）。 */
    __mockApi?: MockApi
  }
}

export {}
