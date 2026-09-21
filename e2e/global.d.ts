/**
 * e2e 在 `page.evaluate` 裡會用到的瀏覽器端全域。
 *
 * 這裡刻意只宣告最小介面而不 import `src/api/types`：
 * e2e 是獨立的 tsconfig（Node 環境），不該把應用程式的型別圖拉進來；
 * 需要的也只有測試鉤子這三支。真後端上線後 `window.__mockApi` 會是 undefined，
 * 用到它的測試要 `test.skip(!__mockApi)`。
 */
export {}

declare global {
  interface Window {
    __mockApi?: {
      failNext(method: string, err?: unknown, times?: number): void
      setLatency(ms: number): void
      reset(): void
    }
  }
}
