import { ApiError, type ApiErrorCode, type LoginFailReason } from '@/api/types'

// api 錯誤的畫面文案。Dashboard 與總覽共用，所以不放在某一頁的常數檔。

/**
 * api 錯誤碼對應的固定中文（review M2）。
 * server 原文（`ApiError.message`）只進 console，畫面只給這一句 + 操作名稱。
 */
export const API_ERROR_TEXT = {
  network: '連線失敗',
  validation: '資料不合法',
  unauthorized: '登入已失效',
  forbidden: '沒有權限',
  not_found: '資料已不存在',
  conflict: '與伺服器狀態衝突',
  unknown: '發生錯誤',
} as const satisfies Record<ApiErrorCode, string>

/**
 * 登入頁的失敗文案（`api.login()` 的 `reason`）。帳密錯不分是帳號還是密碼錯（後端也分不出來，
 * 而且分得出來就能拿來試探帳號存不存在）。
 * `locked` 的「15 分鐘」是後端 `LOGIN_LOCK_MINUTES` 的預設值：改那個設定時這裡要一起改。
 */
export const LOGIN_FAIL_TEXT = {
  invalid: '帳號或密碼錯誤',
  forbidden: '沒有 PMIS 使用權限',
  locked: '嘗試太多次，請 15 分鐘後再試',
  unavailable: '驗證服務暫時無法使用',
} as const satisfies Record<LoginFailReason, string>

/** 帳號或密碼沒填就按登入。 */
export const LOGIN_EMPTY_TEXT = '請輸入帳號與密碼'

/** 任何例外 → 錯誤碼；不是 ApiError 的一律 unknown。 */
export function apiErrorCode(error: unknown): ApiErrorCode {
  return error instanceof ApiError ? error.code : 'unknown'
}
