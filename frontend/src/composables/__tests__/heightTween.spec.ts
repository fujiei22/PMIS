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

/**
 * 包住 inner 的外框（例：.ov-stage 裡的泳道卡片網格）：自然高度＝自己的內容（extra）＋ inner 現在畫出來的高度
 * （inner 被撐住就是撐住的值），所以外框量到多少取決於 inner 這一幀寫好了沒。
 */
function outerBox(extra: { h: number }, inner: HTMLElement): HTMLElement {
  const el = document.createElement('div')
  el.appendChild(inner)
  el.getBoundingClientRect = () =>
    ({ height: el.style.height ? parseFloat(el.style.height) : extra.h + inner.getBoundingClientRect().height }) as DOMRect
  document.body.appendChild(el)
  return el
}

/** 推進 n 幀，記下每幀結束時各元素的 inline height（沒撐住記 null）；onFrame(i) 在推進第 i 幀之前呼叫。 */
function frames(els: HTMLElement[], n: number, onFrame?: (i: number) => void): (number | null)[][] {
  const out: (number | null)[][] = []
  for (let i = 0; i < n; i++) {
    onFrame?.(i)
    vi.advanceTimersToNextFrame()
    out.push(els.map((el) => (el.style.height ? parseFloat(el.style.height) : null)))
  }
  return out
}

/**
 * 模擬瀏覽器的版面計算次數：寫入（inline height、html 的 min-height）讓版面變髒，之後第一次讀
 * （getBoundingClientRect、scrollHeight）就要先重算版面，算一次強制版面計算；每幀開始時版面是乾淨的（上一幀已畫完）。
 */
function layoutProbe(els: HTMLElement[]): {
  frame: () => { layouts: number; scrollReads: number; pins: number }
  restore: () => void
} {
  const html = document.documentElement
  Object.defineProperty(html, 'scrollHeight', { configurable: true, get: () => 1234 })
  const pin = vi.spyOn(html.style, 'minHeight', 'set')
  const writes = [pin, ...els.map((el) => vi.spyOn(el.style, 'height', 'set'))]
  const scroll = vi.spyOn(html, 'scrollHeight', 'get')
  const reads = [scroll, ...els.map((el) => vi.spyOn(el, 'getBoundingClientRect'))]
  const all = [...writes, ...reads]
  return {
    /** 推進一幀；回傳這一幀強制版面計算幾次、讀幾次 scrollHeight、撐幾次頁高（min-height 寫成 scrollHeight）。 */
    frame() {
      for (const s of all) s.mockClear()
      vi.advanceTimersToNextFrame()
      const ops = [
        ...writes.flatMap((s) => s.mock.invocationCallOrder.map((o) => ({ o, write: true }))),
        ...reads.flatMap((s) => s.mock.invocationCallOrder.map((o) => ({ o, write: false }))),
      ].sort((x, y) => x.o - y.o)
      let dirty = false
      let layouts = 0
      for (const { write } of ops) {
        if (write) dirty = true
        else if (dirty) {
          layouts++
          dirty = false
        }
      }
      const pins = pin.mock.calls.filter(([v]) => v === '1234px').length
      return { layouts, scrollReads: scroll.mock.calls.length, pins }
    },
    restore() {
      for (const s of all) s.mockRestore()
      Reflect.deleteProperty(html, 'scrollHeight')
      html.style.minHeight = ''
    },
  }
}

/**
 * 改前（每個元素各開自己的 rAF、各自量）跑出來的每幀高度，[外框或第一個, 第二個]；共用 rAF 之後必須逐一相同。
 * 情境見各測試。
 */
const BASE_SIBLINGS = [
  [298.2072283926999, 80], [291.70875705514635, 80], [278.09050815481083, 80], [254.50635566284478, 81.43421728584008],
  [222.33545069277105, 86.63299435588291], [190.70887944546047, 97.52759347615135], [192.49072963966856, 116.39491546972418],
  [177.49147145836594, 142.13163944578315], [166.32496855594115, 167.4328964436316], [157.98136149359453, 160.63195277024857],
  [151.76535901199074, 171.88139640622552], [147.20169180140144, 180.25627358304416], [143.95717728775955, 186.51397887980409],
  [141.79109047849968, 191.17598074100695], [140.52425073647285, 194.5987311489489], [140.01995885793005, 197.03211703418035],
  [null, 198.65668214112526], [null, 199.60681194764535], [null, 199.98503085655247], [null, null], [null, null], [null, null],
]
const BASE_NESTED_INNER_FIRST = [
  [240, 198.74505987488993], [240, 194.19612993860247], [240.40035598000352, 184.66335570836756],
  [241.16717688169467, 168.15444896399134], [240.61727971958217, 145.63481548493974], [236.24591351413574, 123.49621561182234],
  [226.76960654080045, 105.92938843470999], [214.21004833347385, 92.80503752607021], [201.72290164167435, 83.0343474864485],
  [190.7926817950332, 75.73369130689522], [181.76337736480613, 70.2946891354919], [174.583978599957, 66.30148032622625],
  [169.090597695088, 63.4625301267896], [165.09750931055822, 61.567204168687226], [162.42596282598709, 60.45871939441375],
  [160.9128137424052, 60.01746400068879], [160.2621253682364, null], [160.00997942896504, null], [null, null], [null, null],
]
const BASE_NESTED_OUTER_FIRST = [
  [240.53783148219003, 200], [242.4873728834561, 200], [246.57284755355676, 198.74505987488993],
  [253.36263430256565, 194.19612993860247], [261.0455900293879, 184.66335570836756], [264.4065409654674, 168.15444896399134],
  [258.91790165947435, 145.63481548493974], [244.3144559603974, 123.49621561182234], [226.2116006435274, 146.24536481983426],
  [245.54348880430416, 138.74573572918297], [238.83796616319594, 133.16248427797058], [233.47024478370366, 128.99068074679727],
  [229.2629671724377, 125.88267950599537], [226.0407132454875, 123.60084590070072], [223.6545788295388, 121.97858864387977],
  [221.98083668631077, 120.89554523924984], [null, 120.26212536823643], [null, 120.00997942896502], [null, null], [null, null],
]

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

describe('heightTween：同時補間的元素共用一個 rAF、先讀完再寫', () => {
  it('兩個互不包含的元素（先後放開、途中目標又變）：每幀寫上去的高度同改前逐一相同，結束後不再排 rAF', () => {
    const na = { h: 300 }
    const nb = { h: 80 }
    const a = box(na)
    const b = box(nb)
    holdHeight(a)
    holdHeight(b)
    na.h = 100
    releaseHeight(a, PANEL)
    const seq = frames([a, b], 22, (i) => {
      if (i === 3) {
        nb.h = 240
        releaseHeight(b, PANEL)
      }
      if (i === 6) na.h = 140
      if (i === 9) nb.h = 200
    })
    expect(seq).toEqual(BASE_SIBLINGS)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('巢狀、內層先放開：外框在內層這一幀寫好之後才量（同改前的先後），每幀高度同改前', () => {
    const ni = { h: 200 }
    const extra = { h: 40 }
    const inner = box(ni)
    const outer = outerBox(extra, inner)
    holdHeight(outer)
    holdHeight(inner)
    ni.h = 60
    releaseHeight(inner, PANEL)
    const seq = frames([outer, inner], 20, (i) => {
      if (i === 2) {
        extra.h = 100
        releaseHeight(outer, PANEL)
      }
    })
    expect(seq).toEqual(BASE_NESTED_INNER_FIRST)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('巢狀、外框先放開：外框量的是內層上一幀的高度（同改前的先後），每幀高度同改前', () => {
    const ni = { h: 200 }
    const extra = { h: 40 }
    const inner = box(ni)
    const outer = outerBox(extra, inner)
    holdHeight(outer)
    holdHeight(inner)
    extra.h = 100
    releaseHeight(outer, PANEL)
    const seq = frames([outer, inner], 20, (i) => {
      if (i === 2) {
        ni.h = 60
        releaseHeight(inner, PANEL)
      }
      if (i === 8) ni.h = 120
    })
    expect(seq).toEqual(BASE_NESTED_OUTER_FIRST)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('三條泳道同時補間：每幀只撐一次頁高（scrollHeight 讀一次）、一次版面計算量完全部；全部結束那幀不量', () => {
    const ns = [{ h: 300 }, { h: 120 }, { h: 200 }]
    const els = ns.map((n) => box(n))
    for (const el of els) holdHeight(el)
    ns[0]!.h = 100
    ns[1]!.h = 260
    ns[2]!.h = 150
    for (const el of els) releaseHeight(el, PANEL)
    const probe = layoutProbe(els)
    try {
      const counts = []
      while (els.some((el) => el.style.height)) counts.push(probe.frame())
      // 最後一幀三條都到時長：只清 inline、不量（同改前）
      expect(counts[counts.length - 1]).toEqual({ layouts: 0, scrollReads: 0, pins: 0 })
      expect(counts.length).toBeGreaterThan(10)
      for (const c of counts.slice(0, -1)) expect(c).toEqual({ layouts: 1, scrollReads: 1, pins: 1 })
      expect(document.documentElement.style.minHeight).toBe('')
    } finally {
      probe.restore()
    }
  })

  it('巢狀同時補間：頁高仍只撐一次，外框等內層寫好再量，多一次版面計算（共 2 次）', () => {
    const ni = { h: 200 }
    const extra = { h: 40 }
    const inner = box(ni)
    const outer = outerBox(extra, inner)
    holdHeight(outer)
    holdHeight(inner)
    ni.h = 60
    extra.h = 100
    releaseHeight(inner, PANEL)
    releaseHeight(outer, PANEL)
    const probe = layoutProbe([outer, inner])
    try {
      const counts = []
      while (outer.style.height || inner.style.height) counts.push(probe.frame())
      expect(counts[counts.length - 1]).toEqual({ layouts: 0, scrollReads: 0, pins: 0 })
      for (const c of counts.slice(0, -1)) expect(c).toEqual({ layouts: 2, scrollReads: 1, pins: 1 })
    } finally {
      probe.restore()
    }
  })

  it('取消其中一個不影響另一個：另一個每幀高度同自己單獨補間時；被取消的停在當下、不再被量', () => {
    const solo = (): (number | null)[] => {
      const n = { h: 300 }
      const el = box(n)
      holdHeight(el)
      n.h = 100
      releaseHeight(el, PANEL)
      return frames([el], 20).map((r) => r[0] ?? null)
    }
    const alone = solo()

    const na = { h: 300 }
    const nb = { h: 50 }
    const a = box(na)
    const b = box(nb)
    holdHeight(a)
    holdHeight(b)
    na.h = 100
    nb.h = 250
    releaseHeight(a, PANEL)
    releaseHeight(b, PANEL)
    let bMeasured = 0
    let bAt = ''
    const seq = frames([a], 20, (i) => {
      if (i !== 5) return
      cancelHeight(b)
      bAt = b.style.height
      const natural = b.getBoundingClientRect
      b.getBoundingClientRect = () => {
        bMeasured++
        return natural()
      }
    }).map((r) => r[0] ?? null)
    expect(seq).toEqual(alone)
    expect(parseFloat(bAt)).toBeGreaterThan(50)
    expect(b.style.height).toBe(bAt)
    expect(bMeasured).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('補間中全部取消（卸載）或全部再撐住：當下就不再排 rAF', () => {
    const ns = [{ h: 300 }, { h: 120 }]
    const [a, b] = ns.map((n) => box(n)) as [HTMLElement, HTMLElement]
    holdHeight(a)
    holdHeight(b)
    ns[0]!.h = 100
    ns[1]!.h = 260
    releaseHeight(a, PANEL)
    releaseHeight(b, PANEL)
    vi.advanceTimersToNextFrame()
    vi.advanceTimersToNextFrame()
    expect(vi.getTimerCount()).toBe(1)
    cancelHeight(a)
    expect(vi.getTimerCount()).toBe(1)
    cancelHeight(b)
    expect(vi.getTimerCount()).toBe(0)

    releaseHeight(a, PANEL)
    releaseHeight(b, PANEL)
    vi.advanceTimersToNextFrame()
    holdHeight(a)
    holdHeight(b)
    expect(vi.getTimerCount()).toBe(0)
  })
})
