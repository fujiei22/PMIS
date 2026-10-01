import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelHeight, holdHeight, releaseHeight, type Timing } from '@/composables/heightTween'
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

  it('預設時長與曲線只在真的要補間時才讀（讀 token 要算 computed style）', () => {
    const spy = vi.spyOn(window, 'getComputedStyle')
    try {
      const n = { h: 200 }
      const el = box(n)
      releaseHeight(el) // 沒撐住
      holdHeight(el)
      releaseHeight(el) // 撐住但內容高度沒變
      expect(spy).not.toHaveBeenCalled()
      holdHeight(el)
      n.h = 100
      releaseHeight(el) // 要補間：才讀 token（jsdom 讀不到 → 時長 0 → 直接放開）
      expect(spy).toHaveBeenCalled()
      expect(el.style.height).toBe('')
    } finally {
      spy.mockRestore()
    }
  })

  it('cancelHeight：停掉進行中的補間，高度停在當下（卸載時元素常還看得到，不跳回自然高度），之後不再寫高度、不再撐頁高', () => {
    const html = document.documentElement
    const n = { h: 300 }
    const el = box(n)
    holdHeight(el)
    n.h = 100
    releaseHeight(el, PANEL)
    for (let i = 0; i < 3; i++) vi.advanceTimersToNextFrame()
    const now = el.style.height
    expect(parseFloat(now)).toBeGreaterThan(100)
    cancelHeight(el)
    expect(el.style.height).toBe(now)
    /** 取消之後還有沒有人拿掉 inline height 量自然高度（補間每幀都會量一次）。 */
    let measured = 0
    const natural = el.getBoundingClientRect
    el.getBoundingClientRect = () => {
      measured++
      return natural()
    }
    const minHeight = vi.spyOn(html.style, 'minHeight', 'set')
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame()
    expect(measured).toBe(0)
    expect(minHeight).not.toHaveBeenCalled()
    expect(el.style.height).toBe(now)
    minHeight.mockRestore()
  })

  it('cancelHeight：沒有補間在跑（只撐住、沒撐住、元素不在）時不動高度、不會出錯', () => {
    const el = box({ h: 200 })
    holdHeight(el)
    cancelHeight(el)
    expect(el.style.height).toBe('200px')
    el.style.height = ''
    cancelHeight(el)
    cancelHeight(null)
    cancelHeight(undefined)
    expect(el.style.height).toBe('')
  })

  it('時長 0（reduced motion 把 token 設 0）：release 直接清掉', () => {
    const el = box({ h: 100 })
    holdHeight(el)
    releaseHeight(el, { duration: 0, ease: PANEL.ease })
    expect(el.style.height).toBe('')
  })

  it.each(['', '50vh'])(
    '量自然高度時撐住整頁最小高度（頁面捲在底部時才不會被夾捲動），量完還原成原值（原值 %j）',
    (prev) => {
      const html = document.documentElement
      Object.defineProperty(html, 'scrollHeight', { configurable: true, get: () => 1234 })
      html.style.minHeight = prev
      const n = { h: 300 }
      const el = box(n)
      const natural = el.getBoundingClientRect
      /** 拿掉 inline height 量自然高度的那幾次，量的當下 html 的 min-height。 */
      const seen: string[] = []
      let watching = false
      el.getBoundingClientRect = () => {
        if (watching && !el.style.height) seen.push(html.style.minHeight)
        return natural()
      }
      holdHeight(el)
      watching = true
      n.h = 100
      releaseHeight(el, PANEL)
      expect(html.style.minHeight).toBe(prev)
      for (let i = 0; i < 30; i++) {
        vi.advanceTimersToNextFrame()
        expect(html.style.minHeight).toBe(prev)
      }
      expect(seen.length).toBeGreaterThan(1)
      expect(seen.every((v) => v === '1234px')).toBe(true)
      Reflect.deleteProperty(html, 'scrollHeight')
      html.style.minHeight = ''
    },
  )
})
