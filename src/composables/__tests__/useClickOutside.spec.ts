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

function down(el: Element): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
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
