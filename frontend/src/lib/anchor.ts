/**
 * 浮層定位：把選單 / 日曆放在觸發元素旁邊，並在貼到視窗邊緣時翻面。
 * 數值逐字取自 legacy/Dashboard.html（`openOpt` :2671、`openICal` :2663、
 * 甘特列與看板卡片的 `onOpenCal` :2831 / :3054），全部是純函式，好單元測試。
 * 新頁的日曆與列選單多了排程規則的說明行與本月假日行（legacy 沒有），高度另外加（`calendarExtra`／`rowMenuExtra`）。
 */
import { visualLen } from '@/lib/format'

/** 觸發元素的位置，只取定位會用到的三邊（相當於 DOMRect 的子集）。 */
export interface AnchorRect {
  left: number
  top: number
  bottom: number
}

/** 視窗大小；瀏覽器端傳 `window.innerWidth / innerHeight`。 */
export interface Viewport {
  width: number
  height: number
}

export interface AnchorPosition {
  left: number
  top: number
}

/** 浮層離視窗左 / 上緣至少留這麼多。legacy 的 `Math.max(8, …)` */
const EDGE = 8
/** 選項選單的預留寬度（legacy :2675 的 240）。 */
const OPTION_MENU_W = 240
/** 一列選項的高度與上下 padding，用來估選單高度（legacy :2676）。 */
const OPTION_ROW_H = 27
const OPTION_PAD = 12
/** 選單最多只長到 9 列，再多就內部捲動（legacy :2675）。 */
const OPTION_MAX_ROWS = 9
/** 日曆浮層的預留寬度（legacy :2665 的 266）。 */
const CALENDAR_W = 266
/** 甘特列「⋮」動作選單的寬與估高（RowActionMenu：標題、工期列、兩個動作）。新頁自己的浮層，legacy 沒有。 */
export const ROW_MENU_W = 220
const ROW_MENU_H = 150

/** 說明行一行的高度：`--fs-caption` 11px × `--lh-body` 1.4。 */
const CAPTION_LINE_H = 15.4
/** 一行放得下幾個全形字：日曆內寬 224px（250 − 兩側 12 的內距 − 框線）、列選單說明行 194px，字 11px。 */
const CALENDAR_CHARS = 20
const ROW_MENU_CHARS = 17

/** 一段說明折成幾行（中日韓與全形字算 1、其餘算 0.5，同 `visualLen`）。 */
function captionLines(text: string, perLine: number): number {
  return text ? Math.ceil(visualLen(text) / perLine) : 0
}

/**
 * 日曆多出來的高度：每則說明行（`.cal-note`，上下距相抵後淨 +4）＋本月假日行（`.cal-holidays`，上距 8）。
 *
 * @param notes 會畫出來的說明行（沒有就空陣列）
 * @param holidays 本月假日那一行的文字（沒有就空字串）
 */
export function calendarExtra(notes: string[], holidays: string): number {
  let h = 0
  for (const n of notes) h += captionLines(n, CALENDAR_CHARS) * CAPTION_LINE_H + 4
  if (holidays) h += captionLines(holidays, CALENDAR_CHARS) * CAPTION_LINE_H + 8
  return Math.round(h)
}

/** 列選單多出來的高度：說明行（`.rm-note`，換到 −1 / +1 下面，列間距 6）。 */
export function rowMenuExtra(note: string): number {
  return note ? Math.round(captionLines(note, ROW_MENU_CHARS) * CAPTION_LINE_H + 6) : 0
}

/**
 * 選項選單的位置：靠左對齊觸發元素，下方放得下就往下開，否則往上翻。
 * legacy `openOpt` :2671。
 *
 * @param rect 觸發元素的 bounding rect
 * @param rowCount 選單有幾列（決定估算高度）
 * @param vp 視窗大小
 */
export function anchorOptionMenu(rect: AnchorRect, rowCount: number, vp: Viewport): AnchorPosition {
  const rows = Math.min(rowCount, OPTION_MAX_ROWS)
  const h = rows * OPTION_ROW_H + OPTION_PAD
  return {
    left: Math.max(EDGE, Math.min(rect.left, vp.width - OPTION_MENU_W)),
    top: vp.height - rect.bottom > h + 10 ? rect.bottom + 5 : Math.max(EDGE, rect.top - h - 5),
  }
}

/**
 * 日曆浮層的位置。任務日曆比 Issue 日曆高一點（多了工期列），所以門檻不同。
 * legacy 任務日曆 :2831 / :3054（340 / 336）、Issue 日曆 `openICal` :2663（336 / 330）。
 *
 * @param rect 觸發元素的 bounding rect
 * @param vp 視窗大小
 * @param kind 'task' = 起訖日期選擇器、'issue' = 單一日期選擇器
 * @param extra 說明行與本月假日行多出來的高度（`calendarExtra`）
 */
export function anchorCalendar(
  rect: AnchorRect,
  vp: Viewport,
  kind: 'task' | 'issue',
  extra = 0,
): AnchorPosition {
  const need = (kind === 'task' ? 340 : 336) + extra
  const up = (kind === 'task' ? 336 : 330) + extra
  return {
    left: Math.max(EDGE, Math.min(rect.left, vp.width - CALENDAR_W)),
    top: vp.height - rect.bottom > need ? rect.bottom + 6 : Math.max(EDGE, rect.top - up),
  }
}

/**
 * 甘特列「⋮」動作選單的位置：右緣對齊「⋮」（選單往左長，不會蓋到時間軸以外的地方），
 * 下方放得下就往下開，否則往上翻；左右都不超出視窗。
 *
 * @param rect 「⋮」的 bounding rect（要 right）
 * @param vp 視窗大小
 * @param extra 說明行多出來的高度（`rowMenuExtra`）
 */
export function anchorRowMenu(
  rect: AnchorRect & { right: number },
  vp: Viewport,
  extra = 0,
): AnchorPosition {
  const h = ROW_MENU_H + extra
  return {
    left: Math.max(EDGE, Math.min(rect.right - ROW_MENU_W, vp.width - ROW_MENU_W - EDGE)),
    top: vp.height - rect.bottom > h + 10 ? rect.bottom + 4 : Math.max(EDGE, rect.top - h - 4),
  }
}

/** 目前視窗大小；SSR / 測試環境沒有 window 時退成 0。 */
export function viewport(): Viewport {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}
