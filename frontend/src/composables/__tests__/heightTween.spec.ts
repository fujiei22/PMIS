import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdHeight, releaseHeight, type Timing } from '@/composables/heightTween'
import { cubicBezier } from '@/lib/easing'

/** 同 --t-panel / --ease；直接給，不依賴 jsdom 讀 CSS 自訂屬性（同批次 A useRowMotion.spec 的做法）。 */
const PANEL: Timing = { duration: 260, ease: cubicBezier(0.4, 0, 0.2, 1) }

/** 自然高度由 natural 決定；inline height 有值時 getBoundingClientRect 回 inline 值（模擬被撐住）。 */
function box(natural: { h: number }): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ height: el.style.height ? parseFloat(el.style.height) : natural.h }) as DOMRect
  document.body.appendChild(el)
  return el
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('heightTween', () => {
  it('hold 寫死現在的高度；release 逐幀補間到自然高度，結束清掉 inline', () => {
    const n = { h: 300 }
    const el = box(n)
    holdHeight(el)
    expect(el.style.height).toBe('300px')
    n.h = 100
    releaseHeight(el, PANEL)
    const hs: number[] = []
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersToNextFrame()
      hs.push(el.style.height ? parseFloat(el.style.height) : NaN)
    }
    const mid = hs.filter((h) => h > 100 && h < 300)
    expect(mid.length).toBeGreaterThan(3)
    expect(hs.every((h, i) => i === 0 || Number.isNaN(h) || Number.isNaN(hs[i - 1]!) || h <= hs[i - 1]!)).toBe(true)
    expect(el.style.height).toBe('')
  })

  it('補間中自然高度又變：目標跟著變，結束時等於新的自然高度', () => {
    const n = { h: 300 }
    const el = box(n)
    holdHeight(el)
    n.h = 100
    releaseHeight(el, PANEL)
    for (let i = 0; i < 5; i++) vi.advanceTimersToNextFrame()
    n.h = 200
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame()
    expect(el.style.height).toBe('')
    expect(el.getBoundingClientRect().height).toBe(200)
  })

  it('補間中再 hold：停在當下的高度', () => {
    const n = { h: 300 }
    const el = box(n)
    holdHeight(el)
    n.h = 100
    releaseHeight(el, PANEL)
    for (let i = 0; i < 5; i++) vi.advanceTimersToNextFrame()
    const now = parseFloat(el.style.height)
    holdHeight(el)
    for (let i = 0; i < 5; i++) vi.advanceTimersToNextFrame()
    expect(parseFloat(el.style.height)).toBe(now)
  })

  it('放開時內容高度沒變（重新渲染但卡片沒進出）：直接清掉，之後內容自己變高也逐幀跟著走', () => {
    const n = { h: 200 }
    const el = box(n)
    holdHeight(el)
    releaseHeight(el, PANEL)
    expect(el.style.height).toBe('')
    n.h = 300 // 例：抽屜接著展開
    vi.advanceTimersToNextFrame()
    expect(el.style.height).toBe('')
    expect(el.getBoundingClientRect().height).toBe(300)
  })

  it('時長 0（reduced motion 把 token 設 0）：release 直接清掉', () => {
    const el = box({ h: 100 })
    holdHeight(el)
    releaseHeight(el, { duration: 0, ease: PANEL.ease })
    expect(el.style.height).toBe('')
  })
})
