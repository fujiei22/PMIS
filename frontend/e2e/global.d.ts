/**
 * e2e 在 `page.evaluate` 裡會用到的瀏覽器端全域。
 *
 * 這裡刻意只宣告最小介面而不 import `src/api/types`：
 * e2e 是獨立的 tsconfig（Node 環境），不該把應用程式的型別圖拉進來；
 * 需要的只有測試鉤子（失敗、延遲、重置、登入狀態、唯讀），加上總覽「Dashboard 改了資料回總覽看得到」那條要直接改資料的兩支
 * （唯讀模式的 e2e 也拿 loadProject 比對資料有沒有被改）。
 * 真後端上線後 `window.__mockApi` 會是 undefined，
 * 用到它的測試要 `test.skip(!__mockApi)`。
 */
export {}

declare global {
  interface Window {
    __mockApi?: {
      failNext(method: string, err?: unknown, times?: number): void
      setLatency(ms: number): void
      reset(): void
      /** null = 登出（之後的請求回 401、導回登入頁）；login.spec 用。 */
      setSession(info: { memberId: string; name: string; role: string } | null): void
      /** 之後的 loadProject 回這個 canEdit（唯讀模式 F2，`e2e/readonly.spec.ts`）。 */
      setCanEdit(v: boolean): void
      /** 只宣告測試會讀到的欄位。 */
      loadProject(id: string): Promise<{ tasks: { id: string; status: string }[] }>
      updateTask(id: string, patch: { status?: string; done?: string }): Promise<unknown>
    }
  }
}
