import { describe, expect, it } from 'vitest'
import { cubicBezier, parseDuration, parseEasing } from '@/lib/easing'

/** 用參數式直接取樣：t 從 0 走到 1，找 x 最接近目標的那一點的 y（慢但一定對，當對照組）。 */
function bruteForce(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bez = (a: number, b: number, t: number): number =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  let best = { dx: Infinity, y: 0 }
  for (let i = 0; i <= 20000; i++) {
    const t = i / 20000
    const dx = Math.abs(bez(x1, x2, t) - x)
    if (dx < best.dx) best = { dx, y: bez(y1, y2, t) }
  }
  return best.y
}

describe('cubicBezier', () => {
  it('與參數式取樣一致（--ease：cubic-bezier(0.4, 0, 0.2, 1)）', () => {
    const ease = cubicBezier(0.4, 0, 0.2, 1)
    for (const x of [0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.97]) {
      expect(ease(x)).toBeCloseTo(bruteForce(0.4, 0, 0.2, 1, x), 3)
    }
  })

  it('兩端固定在 0 與 1，超出範圍夾住', () => {
    const ease = cubicBezier(0.4, 0, 0.2, 1)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-0.5)).toBe(0)
    expect(ease(2)).toBe(1)
  })

  it('一路遞增（補間不會往回走）', () => {
    const ease = cubicBezier(0.4, 0, 0.2, 1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const y = ease(i / 100)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
  })

  it('cubic-bezier(0, 0, 1, 1) 就是線性', () => {
    const linear = cubicBezier(0, 0, 1, 1)
    for (const x of [0.1, 0.33, 0.5, 0.8]) expect(linear(x)).toBeCloseTo(x, 5)
  })
})

describe('parseDuration', () => {
  it('秒與毫秒都讀得懂，前後空白不影響', () => {
    expect(parseDuration('0.2s')).toBe(200)
    expect(parseDuration(' 0.16s ')).toBe(160)
    expect(parseDuration('240ms')).toBe(240)
  })

  it('讀不到（沒有 token、格式不對）回 0：代表不補間', () => {
    expect(parseDuration('')).toBe(0)
    expect(parseDuration('fast')).toBe(0)
  })
})

describe('parseEasing', () => {
  it('cubic-bezier(...) 解析成同一條曲線', () => {
    const ease = parseEasing(' cubic-bezier(0.4, 0, 0.2, 1)')
    const ref = cubicBezier(0.4, 0, 0.2, 1)
    for (const x of [0.2, 0.5, 0.8]) expect(ease(x)).toBeCloseTo(ref(x), 6)
  })

  it('讀不到就退回線性', () => {
    const ease = parseEasing('')
    expect(ease(0.3)).toBeCloseTo(0.3, 6)
  })
})
