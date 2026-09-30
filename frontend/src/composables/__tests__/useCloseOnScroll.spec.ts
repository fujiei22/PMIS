import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCloseOnScroll } from '@/composables/useCloseOnScroll'
import { TOUCH_UI_QUERY } from '@/composables/useMediaQuery'

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

/** jsdom 沒有 matchMedia：on = 觸控裝置（TOUCH_UI_QUERY 成立）。 */
function touch(on: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === TOUCH_UI_QUERY, media: q }))
}

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  vi.unstubAllGlobals()
})

function host() {
  const state = ref<object | null>({})
  const pos = { left: 100, top: 200 }
  const anchor = anchorAt(pos)
  const close = vi.fn(() => {
    state.value = null
  })
  const pop = ref<HTMLElement | null>(null)
  /** 改它讓宿主重畫（例：選了日期，選擇器的內容跟著變）。 */
  const tick = ref(0)
  const w = mount(
    defineComponent({
      setup() {
        useCloseOnScroll({ state, popover: pop, anchor: () => anchor, close })
        return () =>
          h('div', { 'data-tick': tick.value }, [
            h('div', { class: 'pop', ref: pop }, [h('input', { class: 'inner' })]),
            // 不含觸發元素的捲動容器（例：甘特的 .gantt-scroller 之於看板卡片）
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
  const rerender = async (): Promise<void> => {
    tick.value++
    await nextTick()
  }
  return { w, state, pos, anchor, close, scroll, rerender }
}

describe('useCloseOnScroll', () => {
  it('頁面捲動把觸發元素帶走（位移 > 2px）就關', async () => {
    const { pos, close, scroll } = host()
    await nextTick()
    pos.top = 150
    scroll(document)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('頁面捲動沒帶動觸發元素（sticky 欄裡的「⋮」）不關', async () => {
    const { close, scroll } = host()
    await nextTick()
    scroll(document)
    expect(close).not.toHaveBeenCalled()
  })

  it('捲的容器不含觸發元素（甘特橫向補間）：觸發元素因為別的原因移位也不關', async () => {
    const { pos, close, scroll } = host()
    await nextTick()
    // 例：選了早於專案起點的日期，看板卡片換了位置，同時甘特被程式捲動
    pos.top = 150
    scroll()
    expect(close).not.toHaveBeenCalled()
  })

  it('宿主重畫後觸發元素的移位只重設基準（資料造成的換位）；之後捲動但位置沒變 → 不關', async () => {
    const { pos, close, scroll, rerender } = host()
    await nextTick()
    // 例：選了早於專案起點的起日，看板卡片依起日換位（加上瀏覽器 scroll anchoring 的補償）
    pos.top = 150
    await rerender()
    scroll(document)
    expect(close).not.toHaveBeenCalled()
    // 之後真的被捲走：照樣關
    pos.top = 100
    scroll(document)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('觸發元素已經不在 DOM（任務被刪、清單重畫）：一捲動就關', async () => {
    const { anchor, close, scroll } = host()
    await nextTick()
    anchor.remove()
    scroll(document)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('浮層自己內部捲動不關', async () => {
    const { w, pos, close, scroll } = host()
    await nextTick()
    pos.top = 150
    scroll(w.find('.pop').element)
    expect(close).not.toHaveBeenCalled()
  })

  it('觸控裝置上焦點在浮層裡（叫出軟鍵盤會捲動頁面）不關', async () => {
    touch(true)
    const { w, pos, close, scroll } = host()
    await nextTick()
    ;(w.find('.inner').element as HTMLInputElement).focus()
    pos.top = 150
    scroll(document)
    expect(close).not.toHaveBeenCalled()
  })

  it('非觸控裝置上焦點在浮層裡，頁面捲動把觸發元素帶走照樣關', async () => {
    touch(false)
    const { w, pos, close, scroll } = host()
    await nextTick()
    ;(w.find('.inner').element as HTMLInputElement).focus()
    pos.top = 150
    scroll(document)
    expect(close).toHaveBeenCalledTimes(1)
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
