/** useRelativeFlip 的 Web Animations id；freezeLeave 取消位移時認這個（Task 3 起 FLIP 改用 el.animate）。 */
export const FLIP_ID = 'relative-flip'

/**
 * 元素目前的 translate（含進行中的過渡與動畫），給「釘在看得到的位置」與 FLIP 的起點用。
 * 瀏覽器用 DOMMatrixReadOnly 讀 computed transform 的 m41 / m42；jsdom 沒有 DOMMatrix 也不算動畫，退回解析 matrix()。
 */
export function currentTranslate(el: Element): { x: number; y: number } {
  const t = getComputedStyle(el).transform || (el as HTMLElement).style?.transform || ''
  if (!t || t === 'none') return { x: 0, y: 0 }
  if (typeof DOMMatrixReadOnly !== 'undefined') {
    const m = new DOMMatrixReadOnly(t)
    return { x: m.m41, y: m.m42 }
  }
  const v = /matrix\(([^)]+)\)/.exec(t)?.[1]?.split(',').map(Number)
  return { x: v?.[4] ?? 0, y: v?.[5] ?? 0 }
}
