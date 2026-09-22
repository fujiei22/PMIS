import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  useStickyOffsets,
  useStickyOffsetsContext,
  type StickyOffsets,
} from '@/composables/useStickyOffsets'

/** 記下被 observe / unobserve 的元素，並讓測試能自己觸發回呼。 */
type Cb = (entries: { target: Element }[]) => void
let observed: Element[] = []
let unobserved: Element[] = []
let fire: Cb = () => {}

class FakeResizeObserver {
  constructor(cb: Cb) {
    fire = cb
  }
  observe(el: Element): void {
    observed.push(el)
  }
  unobserve(el: Element): void {
    unobserved.push(el)
  }
  disconnect(): void {}
}

/** 造一個量得到高度的元素。 */
function elOfHeight(h: number): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ height: h }) as DOMRect
  return el
}

function mountHost(): { api: StickyOffsets; wrapper: VueWrapper } {
  let api!: StickyOffsets
  const Host = defineComponent({
    setup() {
      api = useStickyOffsets()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { api, wrapper }
}

beforeEach(() => {
  observed = []
  unobserved = []
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
})

afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

describe('useStickyOffsets', () => {
  it('量不到任何元素時用 legacy 的預設值（56 / 47）', () => {
    const { api, wrapper } = mountHost()
    expect(api.panelTop.value).toBe(56)
    expect(api.innerTop('gantt')).toBe(56 + 47)
    wrapper.unmount()
  })

  it('observe 當下就量一次，兩層 sticky 的 top 一起更新', () => {
    const { api, wrapper } = mountHost()
    api.observe('top', elOfHeight(70))
    api.observe('gantt', elOfHeight(52))

    expect(observed).toHaveLength(2)
    expect(api.panelTop.value).toBe(70)
    expect(api.innerTop('gantt')).toBe(122)
    // 沒量過的面板還是用預設
    expect(api.innerTop('kanban')).toBe(70 + 47)
    wrapper.unmount()
  })

  it('ResizeObserver 回呼帶來的新高度會反映到 offset', () => {
    const { api, wrapper } = mountHost()
    const top = elOfHeight(56)
    api.observe('top', top)

    top.getBoundingClientRect = () => ({ height: 88 }) as DOMRect
    fire([{ target: top }])
    expect(api.panelTop.value).toBe(88)
    wrapper.unmount()
  })

  it('同一個 key 換元素會先 unobserve 舊的；傳 null 代表卸載', () => {
    const { api, wrapper } = mountHost()
    const a = elOfHeight(60)
    const b = elOfHeight(90)
    api.observe('top', a)
    api.observe('top', b)
    expect(unobserved).toEqual([a])
    expect(api.panelTop.value).toBe(90)

    api.observe('top', null)
    fire([{ target: b }])
    expect(api.panelTop.value).toBe(90)
    wrapper.unmount()
  })

  it('沒有 provider 時 context 退回預設值且 observe 是 no-op', () => {
    let ctx!: StickyOffsets
    const Lonely = defineComponent({
      setup() {
        ctx = useStickyOffsetsContext()
        return () => h('div')
      },
    })
    const wrapper = mount(Lonely)
    expect(ctx.panelTop.value).toBe(56)
    expect(ctx.innerTop('issues')).toBe(56 + 47)
    expect(() => ctx.observe('top', elOfHeight(99))).not.toThrow()
    wrapper.unmount()
  })
})
