/** 控制字元與反斜線：瀏覽器解析網址時會丟掉 tab / 換行、把 `\` 當 `/`，`/\t/x` 會變成 `//x`。 */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/

/**
 * 登入後要回到哪裡：登入頁網址上的 `?redirect=`（登入守衛帶過來的原路徑）。
 *
 * 只接受站內路徑：`/` 開頭、不是 `//`（瀏覽器當成別的網站，例：`//evil.example`）、
 * 不含控制字元與反斜線，也不回登入頁自己；其他一律回首頁（總覽）。
 * 網址參數誰都能改，不檢查就成了「登入後導到別的網站」的跳板。
 *
 * @param raw `route.query.redirect`：可能沒有、可能是陣列（`?redirect=a&redirect=b`），一律當成不可信。
 */
export function safeRedirect(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_CHARS.test(value)) return '/'
  if (/^\/login(?:[?#]|$)/.test(value)) return '/'
  return value
}
