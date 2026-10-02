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
  // 掛載當下會先捲到今天（資料已到）；之後的測試各自設定捲動位置，不受影響
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

  /*
   * 第一次捲到今天的時機（動畫稽核 K1）：legacy 是掛載後 60ms 才跳，從總覽切進來時那 60ms 落在 Dashboard 淡入期間，
   * 捲動逼出整頁版面、把淡入吃掉。改成資料已到就在掛載當下捲（第一幀之前、頁面還透明）。
   */
  it('資料已到：掛載當下就捲到今天，不用等計時器', () => {
    const clock = useClockStore()
    const ui = useUiStore()
    const taskStore = useTaskStore()
    const sc = scrollerEl(40_000, 800)
    mountScroll(ref(sc), ref(rulerEl()))

    const offset = clock.todayIdx - taskStore.range.a + dayFraction(new Date(clock.now))
    expect(sc.scrollLeft).toBeGreaterThan(0)
    expect(sc.scrollLeft).toBeCloseTo(offset * ui.dayWidth - 400, 0)
  })

  it('資料晚到：任務到齊、DOM 更新完就捲到今天；之後再載入不會再捲', async () => {
    const taskStore = useTaskStore()
    taskStore.load({ ...structuredClone(sampleProject), tasks: [] })
    const sc = scrollerEl(40_000, 800)
    mountScroll(ref(sc), ref(rulerEl()))
    expect(sc.scrollLeft, '還沒有任務：不捲').toBe(0)

    taskStore.load(structuredClone(sampleProject))
    await nextTick()
    const first = sc.scrollLeft
    expect(first, '任務到齊：捲到今天').toBeGreaterThan(0)

    // 使用者自己捲走之後，背景重載（任務數變了）不能再把畫面拉回今天
    sc.scrollLeft = 10
    taskStore.load({
      ...structuredClone(sampleProject),
      tasks: structuredClone(sampleProject).tasks.slice(1),
    })
    await nextTick()
    expect(sc.scrollLeft).toBe(10)
  })

  it('掛載時甘特收合著（沒有 scroller）：不捲，展開後任務數變了也不會被拉回今天（review）', async () => {
    const taskStore = useTaskStore()
    const scroller = ref<HTMLElement | null>(null)
    mountScroll(scroller, ref(rulerEl()))
    // 展開：使用者捲到別的日期
    const sc = scrollerEl(40_000, 800)
    scroller.value = sc
    await nextTick()
    sc.scrollLeft = 10
    // 新增 / 刪除任務、背景重載讓任務數變了
    taskStore.load({
      ...structuredClone(sampleProject),
      tasks: structuredClone(sampleProject).tasks.slice(1),
    })
    await nextTick()
    expect(sc.scrollLeft).toBe(10)
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

  it.each(['pointerdown', 'wheel', 'touchstart'])(
    'scroller 上的 %s 停掉補間，位置留在當下',
    (type) => {
      const sc = scrollerEl(4000, 800)
      const api = mountScroll(ref(sc), ref(rulerEl()))
      const mid = midway(api, sc)

      sc.dispatchEvent(new Event(type))
      flush()
      expect(sc.scrollLeft).toBe(mid)
    },
  )

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

  // review：收合期間專案起點變了（看板把最早的任務往前移），重新展開會捲回舊的 px——整片跳好幾天
  it('scroller 卸載時 shift 更新記住的位置，重掛後捲到補過的位置', async () => {
    const first = scrollerEl(4000, 800)
    const scroller = ref<HTMLElement | null>(first)
    const ruler = ref<HTMLElement | null>(rulerEl())
    const api = mountScroll(scroller, ruler)
    first.scrollLeft = 640
    api.onScroll()

    scroller.value = null
    ruler.value = null
    await nextTick()
    // 收合中專案起點往前 5 天：座標右移 5 × 32px
    api.shift(160)
    expect(api.scrollX.value).toBe(800)

    const second = scrollerEl(4000, 800)
    const secondRuler = rulerEl()
    scroller.value = second
    ruler.value = secondRuler
    await nextTick()
    expect(second.scrollLeft).toBe(800)
    expect(secondRuler.scrollLeft).toBe(800)
  })

  it('scroller 在的時候 shift 直接補捲動位置，尺規與 scrollX 跟著', () => {
    const sc = scrollerEl(4000, 800)
    const ru = rulerEl()
    const api = mountScroll(ref(sc), ref(ru))
    sc.scrollLeft = 300
    api.onScroll()

    api.shift(64)
    expect(sc.scrollLeft).toBe(364)
    expect(ru.scrollLeft).toBe(364)
    expect(api.scrollX.value).toBe(364)
  })
})
