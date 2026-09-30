import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import { useGanttScroll, type GanttScroll } from '@/composables/useGanttScroll'
import { dayFraction } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/**
 * 甘特圖水平捲動：尺規同步、`scrollTo` 的補間終值、`jumpToday` 的落點、縮放。
 * legacy 對照：`jumpToday` :2641-2665、`onDayW` :3582。
 */

/** 攔下 rAF，補間的每一幀由測試自己推。 */
let frames: FrameRequestCallback[] = []

/** 造一顆假的捲動容器：jsdom 沒有版面，scrollLeft 與尺寸都自己接管。 */
function scrollerEl(scrollWidth = 4000, clientWidth = 800): HTMLElement {
  const el = document.createElement('div')
  let sl = 0
  Object.defineProperty(el, 'scrollLeft', { get: () => sl, set: (v: number) => void (sl = v) })
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth })
  return el
}

function rulerEl(): HTMLElement {
  const el = document.createElement('div')
  let sl = 0
  Object.defineProperty(el, 'scrollLeft', { get: () => sl, set: (v: number) => void (sl = v) })
  return el
}

function mountScroll(
  scroller: Ref<HTMLElement | null>,
  ruler: Ref<HTMLElement | null>,
): GanttScroll {
  let api!: GanttScroll
  const Host = defineComponent({
    setup() {
      api = useGanttScroll(scroller, ruler)
      return () => h('div')
    },
  })
  mount(Host)
  return api
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockApi.reset(structuredClone(sampleProject))
  useTaskStore().load(structuredClone(sampleProject))
  // 掛載後 60ms 的初始 jumpToday 用假計時器擋住，測試自己控制捲動位置
  vi.useFakeTimers()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useGanttScroll', () => {
  it('onScroll 把 scroller 的位置同步到尺規與 scrollX', () => {
    const sc = scrollerEl()
    const ru = rulerEl()
    const api = mountScroll(ref(sc), ref(ru))

    sc.scrollLeft = 300
    api.onScroll()

    expect(ru.scrollLeft).toBe(300)
    expect(api.scrollX.value).toBe(300)
  })

  it('scrollTo 不補間時直接到終值並夾在可捲範圍內', () => {
    const sc = scrollerEl(4000, 800)
    const ru = rulerEl()
    const api = mountScroll(ref(sc), ref(ru))

    api.scrollTo(500)
    expect(sc.scrollLeft).toBe(500)
    expect(ru.scrollLeft).toBe(500)

    // 上限 = scrollWidth - clientWidth
    api.scrollTo(99_999)
    expect(sc.scrollLeft).toBe(3200)
    api.scrollTo(-50)
    expect(sc.scrollLeft).toBe(0)
  })

  it('scrollTo 補間：跑完最後一幀停在終值，尺規跟著', () => {
    const sc = scrollerEl(4000, 800)
    const ru = rulerEl()
    const api = mountScroll(ref(sc), ref(ru))

    api.scrollTo(1200, true)
    expect(frames).toHaveLength(1)
    // 中途：還沒到終點
    frames.pop()!(performance.now() + 100)
    expect(sc.scrollLeft).toBeGreaterThan(0)
    expect(sc.scrollLeft).toBeLessThan(1200)
    // 時間走完（動畫上限 1150ms）→ 終值
    frames.pop()!(performance.now() + 5000)
    expect(sc.scrollLeft).toBe(1200)
    expect(ru.scrollLeft).toBe(1200)
  })

  it('jumpToday 讓今天落在畫面中央', () => {
    const clock = useClockStore()
    const ui = useUiStore()
    const taskStore = useTaskStore()
    const sc = scrollerEl(4000, 800)
    const api = mountScroll(ref(sc), ref(rulerEl()))

    clock.now = Date.parse('2026-09-21T03:00:00Z')
    api.jumpToday(false)

    const offset = clock.todayIdx - taskStore.range.a + dayFraction(new Date(clock.now))
    expect(sc.scrollLeft).toBeCloseTo(offset * ui.dayWidth - 400, 5)
  })

  it('onZoom 改 dayWidth，160ms 內 zooming 為真', () => {
    const ui = useUiStore()
    const api = mountScroll(ref(scrollerEl()), ref(rulerEl()))

    api.onZoom('20')
    expect(ui.dayWidth).toBe(20)
    expect(ui.zooming).toBe(true)

    vi.advanceTimersByTime(200)
    expect(ui.zooming).toBe(false)

    // 不是數字就什麼都不做
    api.onZoom('abc')
    expect(ui.dayWidth).toBe(20)
  })
})
// 動畫稽核 D7：「今天」與選取 focus 的捲動補間不讓位給使用者——期間拖條會把捲動量算進拖曳（改錯日期）、
// 滾輪無效、縮放後今天偏掉。使用者一動手就要停。
describe('useGanttScroll 的捲動補間讓位給使用者（D7）', () => {
  /** 開一段補間、跑到中途，回傳中途的位置。 */
  function midway(api: GanttScroll, sc: HTMLElement): number {
    api.scrollTo(1200, true)
    frames.pop()!(performance.now() + 100)
    const mid = sc.scrollLeft
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1200)
    return mid
  }

  /** 把排隊中的幀都跑掉（時間走完）；被停掉的補間不該再改位置。 */
  function flush(): void {
    while (frames.length) frames.pop()!(performance.now() + 5000)
  }

  it.each(['pointerdown', 'wheel', 'touchstart'])('scroller 上的 %s 停掉補間，位置留在當下', (type) => {
    const sc = scrollerEl(4000, 800)
    const api = mountScroll(ref(sc), ref(rulerEl()))
    const mid = midway(api, sc)

    sc.dispatchEvent(new Event(type))
    flush()
    expect(sc.scrollLeft).toBe(mid)
  })

  it('縮放時停掉補間（不然會捲到舊比例算出來的位置）', () => {
    const sc = scrollerEl(4000, 800)
    const api = mountScroll(ref(sc), ref(rulerEl()))
    const mid = midway(api, sc)

    api.onZoom('20')
    flush()
    expect(sc.scrollLeft).toBe(mid)
  })

  it('scroller 換了一顆（面板收合再展開）也照樣監聽', async () => {
    const first = scrollerEl(4000, 800)
    const scroller = ref<HTMLElement | null>(first)
    const api = mountScroll(scroller, ref(rulerEl()))
    const second = scrollerEl(4000, 800)
    scroller.value = second
    await nextTick()
    const mid = midway(api, second)

    second.dispatchEvent(new Event('wheel'))
    flush()
    expect(second.scrollLeft).toBe(mid)
  })
})

// 動畫稽核 D12：甘特面板收合 320ms 後卸載內容，再展開時 scroller 是新的一顆、從 0 開始（捲回專案起點、看不到今天）
describe('useGanttScroll：面板收合再展開保留水平捲動位置（D12）', () => {
  it('scroller 換了一顆：捲到上一顆最後的位置，尺規跟著', async () => {
    const first = scrollerEl(4000, 800)
    const scroller = ref<HTMLElement | null>(first)
    const ruler = ref<HTMLElement | null>(rulerEl())
    const api = mountScroll(scroller, ruler)
    first.scrollLeft = 640
    api.onScroll()

    // 收合：內容卸載
    scroller.value = null
    ruler.value = null
    await nextTick()
    // 展開：新的一顆 scroller / 尺規
    const second = scrollerEl(4000, 800)
    const secondRuler = rulerEl()
    scroller.value = second
    ruler.value = secondRuler
    await nextTick()

    expect(second.scrollLeft).toBe(640)
    expect(secondRuler.scrollLeft).toBe(640)
    expect(api.scrollX.value).toBe(640)
  })
})
