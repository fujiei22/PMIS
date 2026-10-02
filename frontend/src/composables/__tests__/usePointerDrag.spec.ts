import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_NOW, useSampleCalendar } from '@/__tests__/loadSample'
import { api, mockApi as maybeMockApi } from '@/api'
import { provideDomRegistry, registerEl, type DomRegistry } from '@/composables/useDomRegistry'
import { usePointerDrag, type PointerDrag } from '@/composables/usePointerDrag'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { scheduleTasks } from '@/lib/schedule'
import { createWorkdays } from '@/lib/workdays'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useProjectStore } from '@/stores/project'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { ProjectData } from '@/types/models'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/** jsdom 沒有 PointerEvent 建構子，拖曳只用到 button / clientX / clientY，用 MouseEvent 代打。 */
function pointer(type: string, x = 0, y = 0): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
}

/**
 * 掛一個最小宿主元件，把 usePointerDrag 的 API 撈出來。
 *
 * 登錄表由外層 provide（正式碼是 DashboardView）、拖曳在內層 inject（GanttPanel），
 * 因為 Vue 的 `inject` 看的是父層的 provides，同一顆元件 provide 完自己 inject 不到。
 */
function mountDrag(): { api: PointerDrag; registry: DomRegistry; unmount: () => void } {
  let api!: PointerDrag
  let registry!: DomRegistry
  const Inner = defineComponent({
    setup() {
      const gantt = ref<HTMLElement | null>(null)
      const chart = ref<HTMLElement | null>(null)
      const vscroll = ref<HTMLElement | null>(null)
      api = usePointerDrag({ gantt, chart, vscroll })
      return () => h('div')
    },
  })
  const Host = defineComponent({
    setup() {
      registry = provideDomRegistry()
      return () => h(Inner)
    },
  })
  const wrapper = mount(Host, { attachTo: document.body })
  return { api, registry, unmount: () => wrapper.unmount() }
}

/**
 * 拖曳用的範例：t24（未開始的根任務、工期 6）挪到 10/13（二），前後幾天都是工作天，拖幾天就落在幾天。
 * 原本的 10/08 往後一天就碰到 10/09–10/12 的連假，落點會順延（規則見 docs/reference/scheduling.md）；
 * 已完成的任務（以前拖的 t1、t28）開始日是實際值，不該拿來當「可以拖的條」。
 */
function loadDragSample(): void {
  setActivePinia(createPinia())
  const data: ProjectData = structuredClone(sampleProject)
  data.tasks.find((t) => t.id === 't24')!.start = '2026-10-13'
  // 存的起訖也照新的開始日排好（t24 與下游），載入時沒有漂移、放開時不會順便寫回別筆
  data.tasks = scheduleTasks(
    data.tasks,
    data.deps,
    createWorkdays(sampleCalendar),
    dayIndex('2026-09-18'),
  )
  mockApi.reset(structuredClone(data))
  useClockStore().now = SAMPLE_NOW
  useSampleCalendar()
  void useTaskStore().load(data)
}

/** 造一顆只有矩形的假元素；一律不進 document，確保命中只能來自登錄表。 */
function elAt(rect: { top: number; bottom: number; left?: number; right?: number }): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({
      left: rect.left ?? 0,
      right: rect.right ?? 100,
      top: rect.top,
      bottom: rect.bottom,
    }) as DOMRect
  return el
}

describe('usePointerDrag 的中止事件（review M3）', () => {
  beforeEach(() => {
    loadDragSample()
    // jsdom 沒有實作 elementFromPoint；onUp 會退回 ui.nearTaskId
    if (!document.elementFromPoint) {
      ;(document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () =>
        null
    }
  })

  afterEach(() => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  it('pointerup 拉線會建相依（對照組）', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api, unmount } = mountDrag()
    const before = tasks.deps.length

    api.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    expect(ui.drag).not.toBeNull()
    ui.nearTaskId = 't3'
    document.dispatchEvent(pointer('pointerup'))

    expect(ui.drag).toBeNull()
    expect(tasks.deps.length).toBe(before + 1)
    unmount()
  })

  it('pointercancel 清掉拖曳狀態但不建相依', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api, unmount } = mountDrag()
    const before = tasks.deps.length

    api.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    ui.nearTaskId = 't3'
    expect(ui.drag).not.toBeNull()
    expect(ui.linkLine).not.toBeNull()
    expect(document.body.style.userSelect).toBe('none')

    document.dispatchEvent(pointer('pointercancel'))

    expect(ui.drag).toBeNull()
    expect(ui.linkLine).toBeNull()
    expect(ui.nearTaskId).toBeNull()
    expect(document.body.style.userSelect).toBe('')
    expect(tasks.deps.length).toBe(before)
    unmount()
  })

  it('lostpointercapture 同樣中止拖曳', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api, unmount } = mountDrag()
    const before = tasks.deps.length

    api.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    ui.nearTaskId = 't3'
    document.dispatchEvent(pointer('lostpointercapture'))

    expect(ui.drag).toBeNull()
    expect(ui.linkLine).toBeNull()
    expect(ui.nearTaskId).toBeNull()
    expect(tasks.deps.length).toBe(before)
    unmount()
  })

  it('平移被中止：還原 cursor、停自動捲動、不當成點空白處清選取', () => {
    const ui = useUiStore()
    const selection = useSelectionStore()
    const cancelRaf = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const { api, unmount } = mountDrag()
    selection.selectTask('t1')

    api.startPan(pointer('pointerdown', 100, 100) as unknown as PointerEvent)
    expect(ui.drag?.kind).toBe('pan')
    expect(document.body.style.cursor).toBe('grabbing')

    document.dispatchEvent(pointer('pointercancel', 100, 100))

    expect(ui.drag).toBeNull()
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(cancelRaf).toHaveBeenCalled()
    // 中止不是「放開」，不走 legacy :2584 的點擊判定
    expect(selection.taskId).toBe('t1')
    cancelRaf.mockRestore()
    unmount()
  })

  // review C1：拖曳的每個 tick 只改本地，放開才送一次
  it('條的移動：tick 只改本地，pointerup 才寫回一次 updateTasks', () => {
    const tasks = useTaskStore()
    const one = vi.spyOn(api, 'updateTask')
    const many = vi.spyOn(api, 'updateTasks')
    const { api: drag, unmount } = mountDrag()
    const s0 = dayIndex(tasks.taskById('t24')!.start)

    drag.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't24', 'move')
    for (const x of [32, 64, 96]) document.dispatchEvent(pointer('pointermove', x, 0))
    expect(tasks.taskById('t24')!.start).toBe(isoFromIndex(s0 + 3))
    expect(one).not.toHaveBeenCalled()
    expect(many).not.toHaveBeenCalled()

    document.dispatchEvent(pointer('pointerup', 96, 0))
    expect(many).toHaveBeenCalledTimes(1)
    expect(many.mock.calls[0]![0].some((t) => t.id === 't24')).toBe(true)
    one.mockRestore()
    many.mockRestore()
    unmount()
  })

  it('條的移動被中止 → 本地放回最後已知的 server 狀態', () => {
    const tasks = useTaskStore()
    const many = vi.spyOn(api, 'updateTasks')
    const { api: drag, unmount } = mountDrag()
    const before = tasks.taskById('t24')!.start

    drag.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't24', 'move')
    document.dispatchEvent(pointer('pointermove', 96, 0))
    expect(tasks.taskById('t24')!.start).not.toBe(before)

    document.dispatchEvent(pointer('pointercancel', 96, 0))
    expect(tasks.taskById('t24')!.start).toBe(before)
    expect(many).not.toHaveBeenCalled()
    many.mockRestore()
    unmount()
  })

  it('列重排：落點來自 registry 的 rows 查表（不再 querySelector）', () => {
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountDrag()
    const move = vi.spyOn(tasks, 'moveTaskToLocal')

    // 只登錄被拖的那一列；元素不在 document 裡，querySelector 找不到
    registerEl(registry.rows, 't3')(elAt({ top: 0, bottom: 34 }))

    drag.startReorder(pointer('pointerdown', 0, 17) as unknown as PointerEvent, 't3')
    document.dispatchEvent(pointer('pointermove', 0, 200))

    expect(move).toHaveBeenCalledTimes(1)
    expect(move.mock.calls[0]![0]).toBe('t3')
    expect(move.mock.calls[0]![1]).toEqual({ kind: 't', id: 't4' })
    document.dispatchEvent(pointer('pointerup', 0, 200))
    move.mockRestore()
    unmount()
  })

  it('分類重排：blockRect 由 groups / rows 查表算出', () => {
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountDrag()
    const move = vi.spyOn(tasks, 'moveGroupLocal')

    registerEl(registry.groups, 'g1')(elAt({ top: 0, bottom: 34 }))
    registerEl(registry.rows, 't1')(elAt({ top: 34, bottom: 68 }))
    registerEl(registry.groups, 'g2')(elAt({ top: 68, bottom: 102 }))
    registerEl(registry.rows, 't7')(elAt({ top: 102, bottom: 136 }))

    drag.startGroupReorder(pointer('pointerdown', 0, 17) as unknown as PointerEvent, 'g1')
    // y 超過自己整塊（bottom 68）也超過下一塊的一半（68 + 34）
    document.dispatchEvent(pointer('pointermove', 0, 110))

    expect(move).toHaveBeenCalledWith('g1', 1)
    document.dispatchEvent(pointer('pointerup', 0, 110))
    move.mockRestore()
    unmount()
  })

  it('拉線放開：命中 registry 的 bars 就建相依（不用 elementFromPoint）', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountDrag()
    const before = tasks.deps.length

    registerEl(registry.bars, 't3')(elAt({ top: 100, bottom: 122, left: 200, right: 320 }))

    drag.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    // 沒有 nearTaskId 可退，命中只能來自登錄表
    ui.nearTaskId = null
    document.dispatchEvent(pointer('pointerup', 260, 110))

    expect(tasks.deps.length).toBe(before + 1)
    expect(tasks.deps[tasks.deps.length - 1]).toMatchObject({ from: 't1', to: 't3' })
    unmount()
  })

  it('拉線放開：命中 linkDots 的圓點熱區也算', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountDrag()
    const before = tasks.deps.length

    registry.linkDots.set('t5', {
      L: elAt({ top: 90, bottom: 130, left: 160, right: 192 }),
      R: elAt({ top: 90, bottom: 130, left: 330, right: 362 }),
    })

    drag.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    ui.nearTaskId = null
    document.dispatchEvent(pointer('pointerup', 176, 110))

    expect(tasks.deps.length).toBe(before + 1)
    expect(tasks.deps[tasks.deps.length - 1]).toMatchObject({ from: 't1', to: 't5' })
    unmount()
  })

  it('拉線放開：都沒命中就退回最後壓到的那一列', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountDrag()
    const before = tasks.deps.length

    registerEl(registry.bars, 't3')(elAt({ top: 100, bottom: 122, left: 200, right: 320 }))

    drag.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    ui.nearTaskId = 't4'
    // 落點在 t3 的條之外
    document.dispatchEvent(pointer('pointerup', 900, 900))

    expect(tasks.deps.length).toBe(before + 1)
    expect(tasks.deps[tasks.deps.length - 1]).toMatchObject({ from: 't1', to: 't4' })
    unmount()
  })

  // review F4：摘要條的 key 是 `sum-<gid>`，不是任務 id
  it('拉線放開在收合分類的摘要條上：不建相依、也不推錯誤條', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountDrag()
    const before = tasks.deps.length

    registerEl(registry.bars, 'sum-g2')(elAt({ top: 100, bottom: 110, left: 200, right: 320 }))

    drag.startLink(pointer('pointerdown') as unknown as PointerEvent, 't1', 'R')
    ui.nearTaskId = null
    document.dispatchEvent(pointer('pointerup', 260, 105))

    expect(tasks.deps.length).toBe(before)
    expect(ui.errors).toEqual([])
    unmount()
  })

  it('中止後條的移動不再跟著指標跑', () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const { api, unmount } = mountDrag()
    const start0 = tasks.taskById('t24')!.start

    api.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't24', 'move')
    document.dispatchEvent(pointer('pointercancel', 0, 0))
    document.dispatchEvent(pointer('pointermove', 500, 0))

    expect(ui.drag).toBeNull()
    expect(tasks.taskById('t24')!.start).toBe(start0)
    unmount()
  })
})
// 動畫稽核 D16：排序放手時游標不在把手上，click 會派給把手與放手處的共同祖先（整列），被當成點選
describe('排序拖曳放手後的 click（D16）', () => {
  beforeEach(() => {
    loadDragSample()
  })

  afterEach(() => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    document.body.innerHTML = ''
  })

  /** 一顆掛在 document 上、會記錄 click 的元素（模擬整列的 @click="onSelect"）。 */
  function clickTarget(): { el: HTMLElement; clicks: () => number } {
    const el = document.createElement('div')
    document.body.appendChild(el)
    let n = 0
    el.addEventListener('click', () => n++)
    return { el, clicks: () => n }
  }

  it('列排序有位移：放手後的那一次 click 被吞掉，之後的點擊照常', async () => {
    const { api: drag, unmount } = mountDrag()
    const row = clickTarget()

    drag.startReorder(pointer('pointerdown', 20, 100) as unknown as PointerEvent, 't4')
    document.dispatchEvent(pointer('pointermove', 20, 130))
    document.dispatchEvent(pointer('pointerup', 100, 134))
    row.el.dispatchEvent(pointer('click', 100, 134))
    expect(row.clicks()).toBe(0)

    // 放手之後這一輪事件跑完就撤掉攔截，下一次真正的點擊不受影響
    await new Promise((r) => setTimeout(r, 0))
    row.el.dispatchEvent(pointer('click', 100, 134))
    expect(row.clicks()).toBe(1)
    unmount()
  })

  it('分類排序有位移：同樣吞掉放手後的 click', () => {
    const { api: drag, unmount } = mountDrag()
    const row = clickTarget()

    drag.startGroupReorder(pointer('pointerdown', 20, 100) as unknown as PointerEvent, 'g1')
    document.dispatchEvent(pointer('pointermove', 20, 300))
    document.dispatchEvent(pointer('pointerup', 90, 300))
    row.el.dispatchEvent(pointer('click', 90, 300))
    expect(row.clicks()).toBe(0)
    unmount()
  })

  it('沒有位移（只是按一下把手）：click 照常派送', () => {
    const { api: drag, unmount } = mountDrag()
    const row = clickTarget()

    drag.startReorder(pointer('pointerdown', 20, 100) as unknown as PointerEvent, 't4')
    document.dispatchEvent(pointer('pointerup', 20, 100))
    row.el.dispatchEvent(pointer('click', 20, 100))
    expect(row.clicks()).toBe(1)
    unmount()
  })

  it('條的移動不吞 click（放手點條切換選取維持 legacy 行為）', () => {
    const { api: drag, unmount } = mountDrag()
    const row = clickTarget()

    drag.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't24', 'move')
    document.dispatchEvent(pointer('pointermove', 96, 0))
    document.dispatchEvent(pointer('pointerup', 96, 0))
    row.el.dispatchEvent(pointer('click', 96, 0))
    expect(row.clicks()).toBe(1)
    unmount()
  })
})

// 動畫稽核 D6 / D13：自動捲動時條以整天吸附、scrollLeft 卻連續變 → 條在游標下鋸齒抖動；
// 專案起點外移時所有座標換基準，捲動位置補回之後，拖曳的基準也要跟著補，否則多算好幾天
describe('條的拖曳：自動捲動的補償與座標換基準（D6 / D13）', () => {
  beforeEach(() => {
    loadDragSample()
  })

  afterEach(() => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  /** 掛拖曳，並給它一顆 scrollLeft 由測試控制的甘特捲動容器。 */
  function mountWithScroller(): {
    api: PointerDrag
    registry: DomRegistry
    scroller: HTMLElement
    unmount: () => void
  } {
    let api!: PointerDrag
    let registry!: DomRegistry
    const scroller = document.createElement('div')
    let sl = 0
    Object.defineProperty(scroller, 'scrollLeft', {
      get: () => sl,
      set: (v: number) => void (sl = v),
    })
    const Inner = defineComponent({
      setup() {
        api = usePointerDrag({ gantt: ref(scroller), chart: ref(null), vscroll: ref(null) })
        return () => h('div')
      },
    })
    const Host = defineComponent({
      setup() {
        registry = provideDomRegistry()
        return () => h(Inner)
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    return { api, registry, scroller, unmount: () => wrapper.unmount() }
  }

  it('游標不動、畫面自動捲動：條用 transform 補上還沒湊滿一天的捲動量，湊滿才改日期', () => {
    const tasks = useTaskStore()
    const { api: drag, registry, scroller, unmount } = mountWithScroller()
    const bar = document.createElement('div')
    registerEl(registry.bars, 't24')(bar)
    const s0 = dayIndex(tasks.taskById('t24')!.start)

    drag.startBar(pointer('pointerdown', 500, 0) as unknown as PointerEvent, 't24', 'move')
    scroller.scrollLeft = 10
    document.dispatchEvent(pointer('pointermove', 500, 0))
    // 捲了 10px、日期還沒動：條往右補 10px，畫面上還在游標下
    expect(bar.style.transform).toBe('translateX(10px)')
    expect(dayIndex(tasks.taskById('t24')!.start)).toBe(s0)

    scroller.scrollLeft = 20
    document.dispatchEvent(pointer('pointermove', 500, 0))
    // 捲了 20px：四捨五入成 1 天，條往左補回 12px
    expect(dayIndex(tasks.taskById('t24')!.start)).toBe(s0 + 1)
    expect(bar.style.transform).toBe('translateX(-12px)')

    // 放開：補償拿掉，條落在整天的位置
    document.dispatchEvent(pointer('pointerup', 500, 0))
    expect(bar.style.transform).toBe('')
    unmount()
  })

  it('沒有自動捲動時照舊整天吸附，不加 transform', () => {
    const tasks = useTaskStore()
    const { api: drag, registry, unmount } = mountWithScroller()
    const bar = document.createElement('div')
    registerEl(registry.bars, 't24')(bar)
    const s0 = dayIndex(tasks.taskById('t24')!.start)

    drag.startBar(pointer('pointerdown', 500, 0) as unknown as PointerEvent, 't24', 'move')
    document.dispatchEvent(pointer('pointermove', 540, 0))
    expect(dayIndex(tasks.taskById('t24')!.start)).toBe(s0 + 1)
    expect(bar.style.transform).toBe('')
    document.dispatchEvent(pointer('pointerup', 540, 0))
    unmount()
  })

  /*
   * 縮放的自動捲動補償（D6 延伸）只在被拖的那一端真的落在拖到的那一天時才補（review）：
   * 被夾住（前置任務限制開始日、或已經縮到一天）時那一端停在限制上，再補就會在限制附近來回鋸齒、或短於一天。
   */
  it('縮放補償：左把手被前置任務擋住時不補（條不平移、寬度不補）', () => {
    const tasks = useTaskStore()
    const { api: drag, registry, scroller, unmount } = mountWithScroller()
    const bar = document.createElement('div')
    registerEl(registry.bars, 't25')(bar)
    const s0 = dayIndex(tasks.taskById('t25')!.start)
    // t25 的前置是 t24、還沒開始：開始日由前置決定，往左拖 20 天也不動；再往左捲 10px（還沒湊滿一天的差）
    drag.startBar(pointer('pointerdown', 1000, 0) as unknown as PointerEvent, 't25', 'resL')
    scroller.scrollLeft = -10
    document.dispatchEvent(pointer('pointermove', 1000 - 20 * 32, 0))
    expect(dayIndex(tasks.taskById('t25')!.start), '開始日被前置擋住').toBe(s0)
    expect(bar.style.transform).toBe('')
    expect(bar.style.getPropertyValue('--res-w')).toBe('')
    document.dispatchEvent(pointer('pointerup', 1000 - 20 * 32, 0))
    unmount()
  })

  // 結束日改由工期推算後，右把手送的 end 不再生效；Task 8 把右把手換算成工期時補回這則
  it.todo('縮放補償：右把手已經縮到一天時，往內的補償不讓條短於一天')

  // review：補償（nudge）不改資料，相依線只在資料變後跟一段；要有旗標讓它在補償與放開回彈期間一直跟著條
  it('nudging 在補償與回彈期間為 true、結束後 false；回彈中又開新的拖曳不會被清掉', () => {
    vi.useFakeTimers()
    // 回彈時長讀 --t-bar；jsdom 沒有 tokens.css，這裡給 0.2s
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (p: string) => (p === '--t-bar' ? '0.2s' : ''),
        }) as unknown as CSSStyleDeclaration,
    )
    const { api: drag, registry, scroller, unmount } = mountWithScroller()
    // 游標（x=500）放在捲動容器中間：不然推進計時器時自動捲動會一直把條往後帶，
    // 落到週末或假日就被順延、不算「落在那天」，補償歸零。這裡測的是回彈計時，不是落點
    scroller.getBoundingClientRect = () =>
      ({ left: 0, right: 1000, top: -500, bottom: 500, width: 1000, height: 1000 }) as DOMRect
    registerEl(registry.bars, 't24')(document.createElement('div'))
    expect(drag.nudging.value).toBe(false)

    drag.startBar(pointer('pointerdown', 500, 0) as unknown as PointerEvent, 't24', 'move')
    document.dispatchEvent(pointer('pointermove', 500, 0))
    // 還沒捲動：沒有補償
    expect(drag.nudging.value).toBe(false)
    scroller.scrollLeft = 10
    document.dispatchEvent(pointer('pointermove', 500, 0))
    expect(drag.nudging.value).toBe(true)

    // 放開：回彈（--t-bar）跑完才算結束
    document.dispatchEvent(pointer('pointerup', 500, 0))
    expect(drag.nudging.value).toBe(true)
    vi.advanceTimersByTime(150)
    expect(drag.nudging.value).toBe(true)

    // 回彈途中又拖一次、又有補償：舊回彈的計時器到了也不能清掉
    drag.startBar(pointer('pointerdown', 500, 0) as unknown as PointerEvent, 't24', 'move')
    scroller.scrollLeft = 20
    document.dispatchEvent(pointer('pointermove', 500, 0))
    vi.advanceTimersByTime(100)
    expect(drag.nudging.value).toBe(true)

    document.dispatchEvent(pointer('pointerup', 500, 0))
    vi.advanceTimersByTime(199)
    expect(drag.nudging.value).toBe(true)
    vi.advanceTimersByTime(2)
    expect(drag.nudging.value).toBe(false)
    unmount()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('rebase：捲動位置補回 N px 時，拖曳的基準跟著補，日期不會多算', () => {
    const tasks = useTaskStore()
    const { api: drag, scroller, unmount } = mountWithScroller()
    // t24 沒有前置、還沒開始，可以往前拖（10/13 → 10/12 仍是工作天、晚於今天）
    const s0 = dayIndex(tasks.taskById('t24')!.start)

    drag.startBar(pointer('pointerdown', 500, 0) as unknown as PointerEvent, 't24', 'move')
    document.dispatchEvent(pointer('pointermove', 468, 0))
    expect(dayIndex(tasks.taskById('t24')!.start)).toBe(s0 - 1)

    // 專案起點外移 2 天：所有座標右移 64px，GanttPanel 把 scrollLeft 補 +64
    scroller.scrollLeft += 64
    drag.rebase(64)
    document.dispatchEvent(pointer('pointermove', 468, 0))
    expect(dayIndex(tasks.taskById('t24')!.start)).toBe(s0 - 1)
    document.dispatchEvent(pointer('pointerup', 468, 0))
    unmount()
  })
})

describe('usePointerDrag 的唯讀（F2）', () => {
  beforeEach(() => {
    loadDragSample()
    const project = useProjectStore()
    project.setAll(project.meta, false)
  })

  afterEach(() => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  it('會改資料的四種拖曳不開始，也不攔下事件（按在條上照樣落到畫布去平移）', () => {
    const ui = useUiStore()
    const { api: drag, unmount } = mountDrag()
    const starts: [string, (e: PointerEvent) => void][] = [
      ['startBar', (e) => drag.startBar(e, 't24', 'move')],
      ['startLink', (e) => drag.startLink(e, 't1', 'R')],
      ['startReorder', (e) => drag.startReorder(e, 't4')],
      ['startGroupReorder', (e) => drag.startGroupReorder(e, 'g1')],
    ]
    // 每一種記下「有沒有開始拖」與「有沒有攔下事件」，一次比對
    const result: Record<string, { dragging: boolean; stopped: boolean }> = {}
    for (const [name, start] of starts) {
      const e = pointer('pointerdown') as unknown as PointerEvent
      const stop = vi.spyOn(e, 'stopPropagation')
      start(e)
      result[name] = { dragging: ui.drag !== null, stopped: stop.mock.calls.length > 0 }
    }
    const idle = { dragging: false, stopped: false }
    expect(result).toEqual({
      startBar: idle,
      startLink: idle,
      startReorder: idle,
      startGroupReorder: idle,
    })
    unmount()
  })

  it('平移照常', () => {
    const ui = useUiStore()
    const { api: drag, unmount } = mountDrag()
    drag.startPan(pointer('pointerdown') as unknown as PointerEvent)
    expect(ui.drag?.kind).toBe('pan')
    document.dispatchEvent(pointer('pointerup'))
    expect(ui.drag).toBeNull()
    unmount()
  })
})
