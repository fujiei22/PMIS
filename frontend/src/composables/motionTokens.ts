import { parseDuration } from '@/lib/easing'

/** token 的原始字串（例 '--ease' → 'cubic-bezier(0.4, 0, 0.2, 1)'），給 Web Animations 的 easing。 */
export function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** token 時長（例 '--t-panel'）換成毫秒；reduced motion 把 token 設 0 時回 0（JS 動畫與 CSS 同源）。 */
export function tokenMs(name: string): number {
  return parseDuration(tokenValue(name))
}
