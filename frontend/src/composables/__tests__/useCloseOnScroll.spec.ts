import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCloseOnScroll } from '@/composables/useCloseOnScroll'

/** 觸發元素：jsdom 的 getBoundingClientRect 一律回 0，換成可控的位置。 */
function anchorAt(pos: { left: number; top: number }): HTMLElement {
  const el = document.createElement('button')
  el.getBoundingClientRect = () =>
    ({
      ...pos,
      x: pos.left,
      y: pos.top,
      right: pos.left + 40,
      bottom: pos.top + 20,
      width: 40,
      height: 20,
      toJSON: () => ({}),
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function host() {
  const state = ref<object | null>({})
  const pos = { left: 100, top: 200 }
  const anchor = anchorAt(pos)
  const close = vi.fn(() => {
    state.value = null
  })
  const pop = ref<HTMLElement | null>(null)
  const w = mount(
    defineComponent({
      setup() {
        useCloseOnScroll({ state, popover: pop, anchor: () => anchor, close })
        return () =>
          h('div', [
            h('div', { class: 'pop', ref: pop }, [h('input', { class: 'inner' })]),
            h('div', { class: 'page' }),
          ])
      },
    }),
    { attachTo: document.body },
  )
  cleanups.push(() => {
    w.unmount()
    anchor.remove()
  })
  const scroll = (target: EventTarget = w.find('.page').element): void =>
    void target.dispatchEvent(new Event('scroll'))
  return { w, state, pos, close, scroll }
}

describe('useCloseOnScroll', () => {
  it('捲動把觸發元素帶走（位移 > 2px）就關', async () => {
    const { pos, close, scroll } = host()
    await nextTick()
    pos.top = 150
    scroll()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('捲動沒帶動觸發元素（甘特橫向補間、sticky 欄裡的「⋮」）不關', async () => {
    const { close, scroll } = host()
    await nextTick()
    scroll()
    scroll(document)
    expect(close).not.toHaveBeenCalled()
  })

  it('浮層自己內部捲動不關', async () => {
    const { w, pos, close, scroll } = host()
    await nextTick()
    pos.top = 150
    scroll(w.find('.pop').element)
    expect(close).not.toHaveBeenCalled()
  })

  it('焦點在浮層裡（平板叫出軟鍵盤會捲動頁面）不關', async () => {
    const { w, pos, close, scroll } = host()
    await nextTick()
    ;(w.find('.inner').element as HTMLInputElement).focus()
    pos.top = 150
    scroll(document)
    expect(close).not.toHaveBeenCalled()
  })

  it('關起來之後不再聽；卸載後也不聽', async () => {
    const { w, state, pos, close, scroll } = host()
    await nextTick()
    state.value = null
    await nextTick()
    pos.top = 150
    scroll(document)
    expect(close).not.toHaveBeenCalled()
    state.value = {}
    await nextTick()
    w.unmount()
    scroll(document)
    expect(close).not.toHaveBeenCalled()
  })
})
