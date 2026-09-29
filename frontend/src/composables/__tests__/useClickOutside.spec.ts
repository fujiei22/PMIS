import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useClickOutside } from '@/composables/useClickOutside'
import { sampleProject } from '@/mocks/sampleProject'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 全域 pointerdown（capture）：浮層開著時點 `[data-dd]` 之外就全關，
 * 點在 KEEP_SELECTION 清單之外才清選取。legacy `_docDown` :1905-1913。
 * 手指例外：pointerdown 時分不出「點一下」還是「開始捲動」，清選取延到 click（捲動不會有 click）。
 */

let wrapper: VueWrapper

function mountHost(): void {
  const Host = defineComponent({
    setup() {
      useClickOutside()
      return () => h('div')
    },
  })
  wrapper = mount(Host)
}

/** 在 body 底下放一個測試用節點，回傳它本身（事件從它冒上去）。 */
function addNode(html: string): HTMLElement {
  const holder = document.createElement('div')
  holder.innerHTML = html
  const el = holder.firstElementChild as HTMLElement
  document.body.appendChild(el)
  return el
}

function down(el: Element, pointerType = 'mouse'): void {
  // jsdom 沒有 PointerEvent，用 MouseEvent 補上 pointerType
  const e = new MouseEvent('pointerdown', { bubbles: true })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  el.dispatchEvent(e)
}

beforeEach(() => {
  setActivePinia(createPinia())
  useTaskStore().load(structuredClone(sampleProject))
  document.body.innerHTML = ''
  mountHost()
})

afterEach(() => {
  wrapper.unmount()
  document.body.innerHTML = ''
})

describe('useClickOutside 的浮層', () => {
  it('點在 [data-dd] 內不關浮層', () => {
    const ui = useUiStore()
    ui.openDropdown = 'cdate'
    const inner = addNode('<div data-dd="1"><span class="deep">x</span></div>')

    down(inner.querySelector('.deep')!)
    expect(ui.openDropdown).toBe('cdate')
  })

  it('點在錯誤條（[data-errorbar]）內也不關浮層', () => {
    const ui = useUiStore()
    ui.openDropdown = 'cdate'
    const bar = addNode('<div data-errorbar><span class="dismiss">✕</span></div>')

    down(bar.querySelector('.dismiss')!)
    expect(ui.openDropdown).toBe('cdate')
  })

  it('點在 [data-dd] 外把所有浮層關掉', () => {
    const ui = useUiStore()
    ui.openDropdown = 'cdate'
    ui.memberPickerOpen = true
    ui.filterCalendarOpen = true
    const outside = addNode('<div class="plain">x</div>')

    down(outside)
    expect(ui.openDropdown).toBeNull()
    expect(ui.memberPickerOpen).toBe(false)
    expect(ui.filterCalendarOpen).toBe(false)
  })
})

describe('useClickOutside 的選取', () => {
  it('點在空白處清選取', () => {
    const selection = useSelectionStore()
    selection.taskId = 't1'
    down(addNode('<div class="plain">x</div>'))
    expect(selection.taskId).toBeNull()
  })

  it('點在 [data-taskid] / input 這類元素上不清選取', () => {
    const selection = useSelectionStore()
    selection.taskId = 't1'
    down(addNode('<div data-taskid="t1">bar</div>'))
    expect(selection.taskId).toBe('t1')

    down(addNode('<input />'))
    expect(selection.taskId).toBe('t1')
  })

  it('點在 [data-keep-selection]（只改怎麼看的控制項）上不清選取', () => {
    const selection = useSelectionStore()
    selection.taskId = 't1'
    down(addNode('<button data-keep-selection>展開左欄</button>'))
    expect(selection.taskId).toBe('t1')
  })

  it('詳細視窗開著時完全不動選取', () => {
    const ui = useUiStore()
    const selection = useSelectionStore()
    ui.detail = { id: 't1', kind: 'task', from: null }
    selection.taskId = 't1'
    down(addNode('<div class="plain">x</div>'))
    expect(selection.taskId).toBe('t1')
  })

  it('宿主卸載後不再攔事件', () => {
    const selection = useSelectionStore()
    wrapper.unmount()
    selection.taskId = 't1'
    down(addNode('<div class="plain">x</div>'))
    expect(selection.taskId).toBe('t1')
    mountHost() // afterEach 還要 unmount 一次
  })
})

describe('useClickOutside 的手指操作', () => {
  it('手指按下（可能是開始捲動）不清選取，點一下（click）才清', () => {
    const selection = useSelectionStore()
    selection.taskId = 't1'
    const plain = addNode('<div class="plain">x</div>')
    down(plain, 'touch')
    expect(selection.taskId).toBe('t1')
    plain.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(selection.taskId).toBeNull()
  })

  it('手指點在保留清單裡（任務條）不清選取', () => {
    const selection = useSelectionStore()
    selection.taskId = 't1'
    const bar = addNode('<div data-taskid="t1">bar</div>')
    down(bar, 'touch')
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(selection.taskId).toBe('t1')
  })

  it('滑鼠的 click 不會再清一次（滑鼠在 pointerdown 就決定了）', () => {
    const selection = useSelectionStore()
    const bar = addNode('<div data-taskid="t1">bar</div>')
    down(bar)
    selection.taskId = 't1'
    addNode('<div class="plain">x</div>').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(selection.taskId).toBe('t1')
  })

  it('手指點過之後，鍵盤觸發的 click（detail 0）不當成點到外面', () => {
    const selection = useSelectionStore()
    const bar = addNode('<div data-taskid="t1">bar</div>')
    down(bar, 'touch')
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    selection.taskId = 't1'
    addNode('<button>x</button>').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(selection.taskId).toBe('t1')
  })
})
