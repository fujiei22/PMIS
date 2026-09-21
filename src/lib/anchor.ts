/**
 * 浮層定位：把選單 / 日曆放在觸發元素旁邊，並在貼到視窗邊緣時翻面。
 * 數值逐字取自 legacy/Dashboard.html（`openOpt` :2671、`openICal` :2663、
 * 甘特列與看板卡片的 `onOpenCal` :2831 / :3054），全部是純函式，好單元測試。
 */

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

/**
 * 選項選單的位置：靠左對齊觸發元素，下方放得下就往下開，否則往上翻。
 * legacy `openOpt` :2671。
 *
 * @param rect 觸發元素的 bounding rect
 * @param rowCount 選單有幾列（決定估算高度）
 * @param vp 視窗大小
 */
export function anchorOptionMenu(
  rect: AnchorRect,
  rowCount: number,
  vp: Viewport,
): AnchorPosition {
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
 */
export function anchorCalendar(
  rect: AnchorRect,
  vp: Viewport,
  kind: 'task' | 'issue',
): AnchorPosition {
  const need = kind === 'task' ? 340 : 336
  const up = kind === 'task' ? 336 : 330
  return {
    left: Math.max(EDGE, Math.min(rect.left, vp.width - CALENDAR_W)),
    top: vp.height - rect.bottom > need ? rect.bottom + 6 : Math.max(EDGE, rect.top - up),
  }
}

/** 目前視窗大小；SSR / 測試環境沒有 window 時退成 0。 */
export function viewport(): Viewport {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}
