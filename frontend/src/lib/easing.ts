/**
 * JS 驅動的補間要用的時間函式：把 CSS token（`--t-bar`、`--ease`）讀成數字與函式，
 * 讓 JS 補間的時長與曲線跟 CSS 過渡完全一致（時長只定義在 tokens.css 一處）。
 * 全部是純函式，好單元測試。
 */

/** Newton 法反解的收斂門檻與次數；解不出來再改二分，與瀏覽器的 UnitBezier 同一套做法。 */
const EPSILON = 1e-6
const NEWTON_STEPS = 8

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` 的 JS 版：輸入時間進度 x（0~1），回傳位移進度 y。
 * 曲線以參數 t 表示，x、y 都是 t 的三次式；先由 x 反解 t，再代回算 y。
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  // 三次式的係數（B(t) = ((a·t + b)·t + c)·t）
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx

  function solveT(x: number): number {
    let t = x
    for (let i = 0; i < NEWTON_STEPS; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < EPSILON) return t
      const d = slopeX(t)
      if (Math.abs(d) < EPSILON) break
      t -= err / d
    }
    // 斜率太平、Newton 收斂不了：在 [0, 1] 二分
    let lo = 0
    let hi = 1
    t = x
    while (hi - lo > EPSILON) {
      const v = sampleX(t)
      if (Math.abs(v - x) < EPSILON) return t
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }

  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveT(x)))
}

/** CSS 時長（`0.2s`、`160ms`）換成毫秒；讀不到回 0，呼叫端當成「不補間」。 */
export function parseDuration(value: string): number {
  const m = /^\s*([\d.]+)(ms|s)\s*$/.exec(value)
  if (!m) return 0
  const n = parseFloat(m[1]!)
  return m[2] === 's' ? n * 1000 : n
}

/** CSS easing token 換成時間函式；只認 `cubic-bezier(...)`，讀不到退回線性。 */
export function parseEasing(value: string): (x: number) => number {
  const m = /cubic-bezier\(\s*([^)]+)\)/.exec(value)
  const n = m ? m[1]!.split(',').map((s) => parseFloat(s)) : []
  if (n.length !== 4 || n.some((v) => Number.isNaN(v))) return (x) => Math.min(1, Math.max(0, x))
  return cubicBezier(n[0]!, n[1]!, n[2]!, n[3]!)
}
