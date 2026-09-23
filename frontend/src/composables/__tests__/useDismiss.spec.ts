import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDismiss } from '@/composables/useDismiss'

/**
 * 總覽的浮層關閉：開著時在元件外按下或按 Esc 就 close()，
 * Esc 關閉後焦點回到觸發鈕；關著時、卸載後都不動作。
 */

let outside: HTMLButtonElement

/** 掛一個含 inside 按鈕的元件；outside 按鈕在元件外，returnTo 是要還焦點的觸發鈕。 */
function setup(open: boolean) {
  const close = vi.fn()
  const returnTo = document.createElement('button')
  document.body.appendChild(returnTo)
  const Comp = defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null)
      useDismiss(el, () => open, close, ref(returnTo))
      return () => h('div', { ref: el }, [h('button', { id: 'inside' })])
    },
  })
  outside = document.createElement('button')
  document.body.appendChild(outside)
  const w = mount(Comp, { attachTo: document.body })
  return { w, close, returnTo }
}

describe('useDismiss', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('開著時在外面按下 → close', () => {
    const { close, w } = setup(true)
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(close).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('在裡面按下不關', () => {
    const { close, w } = setup(true)
    w.find('#inside').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    w.unmount()
  })

  it('Esc → close，焦點回到觸發鈕', () => {
    const { close, returnTo, w } = setup(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(close).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(returnTo)
    w.unmount()
  })

  it('關著時什麼都不做', () => {
    const { close, w } = setup(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    w.unmount()
  })

  it('卸載後不再監聽', () => {
    const { close, w } = setup(true)
    w.unmount()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(close).not.toHaveBeenCalled()
  })
})
