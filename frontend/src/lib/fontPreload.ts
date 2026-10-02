/**
 * 預載「一開始不在畫面上、互動之後才第一次出現」的字元所在的字型子集（動畫稽核 J2）。
 *
 * Noto Sans TC（index.html 引 Google Fonts）以 unicode-range 切成上百個子集，瀏覽器只在某個字第一次出現在畫面上時
 * 才下載它所在的子集；子集到了會觸發「Fonts changed」，整頁用這個字型的文字重排一次。
 * 甘特分類的收合鈕平常是「▼」、收合後才變「▶」（U+25B6，跟 ▼ 不在同一個子集）：第一次收合時才下載，
 * 動畫進行中多一個整頁重排的長幀（批次 A 量到 87–118ms；子集已載時 18–19ms）。
 * 啟動時就用 `document.fonts.load` 把這些字所在的子集載起來，重排發生在啟動期間（其他子集也正在載），
 * 不落在使用者的操作上。網路擋掉 Google Fonts 時沒有對應的 @font-face，load 什麼都不做。
 */

/** 要預載的字元：甘特分類收合鈕的「▶」（詳情視窗的屬性標籤也用它）。 */
export const LATE_GLYPHS = '▶'

/** 字型與 index.html 引入的字重；收合鈕與屬性標籤的字重不同，三種都載（每個子集只有幾十 KB）。 */
const FAMILY = 'Noto Sans TC'
const WEIGHTS = [400, 500, 700] as const

/**
 * 開始下載 LATE_GLYPHS 所在的字型子集；不等它完成、失敗也不影響畫面（之後第一次出現時瀏覽器照樣會自己載）。
 * @param fonts 字型集合（測試注入用）；沒有 FontFaceSet 的環境（jsdom）直接跳過。
 */
export function preloadLateGlyphs(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  if (typeof fonts?.load !== 'function') return
  for (const w of WEIGHTS) fonts.load(`${w} 16px "${FAMILY}"`, LATE_GLYPHS).catch(() => {})
}
