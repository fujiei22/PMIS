/**
 * 「登入已失效」的通知（401）：api 層發出，畫面層（`main.ts`）收了導回登入頁。
 *
 * 放在 api 層而不是 store：api 實作不能 import store 或 router（分層，見 README〈store 的三層〉），
 * 只能丟一個通知出去，由最外層決定要做什麼。
 *
 * 誰要呼叫 `notifyUnauthorized()`：api 實作遇到 401 時，先通知再拋 `ApiError('unauthorized')`；
 * `getSession` / `login` / `logout` 自己的 401 不算（那是「還沒登入」或「帳密錯」，不是「登入失效」）。
 */

type Handler = () => void

const handlers = new Set<Handler>()

/** 註冊 401 的處理；回傳取消註冊的函式。 */
export function onUnauthorized(handler: Handler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** api 實作遇到 401 時呼叫。一個 handler 拋錯不影響其他 handler，也不讓呼叫端跟著拋。 */
export function notifyUnauthorized(): void {
  for (const h of [...handlers]) {
    try {
      h()
    } catch (err) {
      console.error('[auth] 401 的處理拋錯', err)
    }
  }
}
