import { ApiError, type ApiErrorCode } from '@/api/types'

// api 錯誤的畫面文案。Dashboard 與總覽共用，所以不放在某一頁的常數檔。

/**
 * api 錯誤碼對應的固定中文（review M2）。
 * server 原文（`ApiError.message`）只進 console，畫面只給這一句 + 操作名稱。
 */
export const API_ERROR_TEXT = {
  network: '連線失敗',
  validation: '資料不合法',
  not_found: '資料已不存在',
  conflict: '與伺服器狀態衝突',
  unknown: '發生錯誤',
} as const satisfies Record<ApiErrorCode, string>

/** 任何例外 → 錯誤碼；不是 ApiError 的一律 unknown。 */
export function apiErrorCode(error: unknown): ApiErrorCode {
  return error instanceof ApiError ? error.code : 'unknown'
}
