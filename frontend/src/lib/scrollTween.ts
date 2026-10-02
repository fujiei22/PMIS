/**
 * 程式平滑捲動（甘特「今天」與選取後捲到條、總覽時間軸「今天」）共用的時長與曲線，兩個時間軸手感一致。
 * 距離越遠越長，夾在 460–1150ms（legacy :2653）；ease-out quart。
 */
export function scrollTweenMs(distance: number): number {
  return Math.max(460, Math.min(1150, 340 + Math.abs(distance) * 0.4))
}

/** ease-out quart：一開始快、越接近終點越慢（p 是 0–1 的時間進度）。 */
export function easeOutQuart(p: number): number {
  return 1 - Math.pow(1 - p, 4)
}
