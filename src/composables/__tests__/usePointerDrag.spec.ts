import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi } from '@/api'
import {
  provideDomRegistry,
  registerEl,
  type DomRegistry,
} from '@/composables/useDomRegistry'
import { usePointerDrag, type PointerDrag } from '@/composables/usePointerDrag'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

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

/** 造一顆只有矩形的假元素；一律不進 document，確保命中只能來自登錄表。 */
function elAt(rect: { top: number; bottom: number; left?: number; right?: number }): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ left: rect.left ?? 0, right: rect.right ?? 100, top: rect.top, bottom: rect.bottom }) as DOMRect
  return el
}

describe('usePointerDrag 的中止事件（review M3）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    useTaskStore().load(structuredClone(sampleProject))
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
  it('條的移動：tick 只改本地，pointerup 才送一次 updateTasks', () => {
    const tasks = useTaskStore()
    const one = vi.spyOn(api, 'updateTask')
    const many = vi.spyOn(api, 'updateTasks')
    const { api: drag, unmount } = mountDrag()
    const t1 = tasks.taskById('t1')!
    const s0 = dayIndex(t1.start)

    drag.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't1', 'move')
    for (const x of [32, 64, 96]) document.dispatchEvent(pointer('pointermove', x, 0))
    expect(tasks.taskById('t1')!.start).toBe(isoFromIndex(s0 + 3))
    expect(one).not.toHaveBeenCalled()
    expect(many).not.toHaveBeenCalled()

    document.dispatchEvent(pointer('pointerup', 96, 0))
    expect(many).toHaveBeenCalledTimes(1)
    expect(many.mock.calls[0]![0].some((t) => t.id === 't1')).toBe(true)
    one.mockRestore()
    many.mockRestore()
    unmount()
  })

  it('條的移動被中止 → 本地放回最後已知的 server 狀態', () => {
    const tasks = useTaskStore()
    const many = vi.spyOn(api, 'updateTasks')
    const { api: drag, unmount } = mountDrag()
    const before = tasks.taskById('t1')!.start

    drag.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't1', 'move')
    document.dispatchEvent(pointer('pointermove', 96, 0))
    expect(tasks.taskById('t1')!.start).not.toBe(before)

    document.dispatchEvent(pointer('pointercancel', 96, 0))
    expect(tasks.taskById('t1')!.start).toBe(before)
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
    const start0 = tasks.taskById('t1')!.start

    api.startBar(pointer('pointerdown', 0, 0) as unknown as PointerEvent, 't1', 'move')
    document.dispatchEvent(pointer('pointercancel', 0, 0))
    document.dispatchEvent(pointer('pointermove', 500, 0))

    expect(ui.drag).toBeNull()
    expect(tasks.taskById('t1')!.start).toBe(start0)
    unmount()
  })
})
