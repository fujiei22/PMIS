import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { useDragPan, type DragPan } from '@/composables/useDragPan'

/**
 * 總覽時間軸的按住拖曳平移。
 *
 * 測什麼：拖超過 4px 才平移、scrollLeft 反向跟著指標走；拖過之後吃掉放手那次 click，沒拖過則照常點擊；
 * 左欄 / 速覽上按下不平移；觸控與非主鍵不接。
 * 為什麼：列本身點一下會展開速覽，拖曳放手不能被當成點擊；左欄與速覽裡有自己的互動。
 * jsdom 沒有 PointerEvent，用 MouseEvent 帶 pointerdown / pointermove / pointerup 的型別代替。
 */

let wrapper: ReturnType<typeof mount> | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

/** 掛一個捲動容器，裡面放畫布與左欄；scrollLeft 自己接管（jsdom 沒有版面）。 */
function setup(): { pan: DragPan; scroller: HTMLElement; canvas: HTMLElement; left: HTMLElement; clicks: () => number } {
  const scroller = document.createElement('div')
  let sl = 200
  Object.defineProperty(scroller, 'scrollLeft', { get: () => sl, set: (v: number) => void (sl = v) })
  const canvas = document.createElement('div')
  canvas.className = 'p-canvas'
  const left = document.createElement('div')
  left.className = 'p-left'
  scroller.append(canvas, left)
  document.body.append(scroller)
  let n = 0
  canvas.addEventListener('click', () => n++)

  let pan!: DragPan
  wrapper = mount(
    defineComponent({
      setup() {
        pan = useDragPan(ref(scroller))
        return () => h('div')
      },
    }),
  )
  scroller.addEventListener('pointerdown', (e) => pan.onPointerDown(e as PointerEvent))
  return { pan, scroller, canvas, left, clicks: () => n }
}

function fire(el: EventTarget, type: string, clientX: number, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, ...init }))
}

describe('useDragPan', () => {
  it('拖超過門檻才平移，scrollLeft 跟指標反向；放手那次 click 被吃掉', () => {
    const { pan, scroller, canvas, clicks } = setup()
    fire(canvas, 'pointerdown', 500)
    fire(document, 'pointermove', 502)
    expect(scroller.scrollLeft).toBe(200)
    expect(pan.panning.value).toBe(false)
    fire(document, 'pointermove', 440)
    expect(scroller.scrollLeft).toBe(260)
    expect(pan.panning.value).toBe(true)
    fire(document, 'pointerup', 440)
    fire(canvas, 'click', 440)
    expect(clicks()).toBe(0)
    expect(pan.panning.value).toBe(false)
  })

  it('沒拖過（小於門檻）照常點擊', () => {
    const { scroller, canvas, clicks } = setup()
    fire(canvas, 'pointerdown', 500)
    fire(document, 'pointermove', 502)
    fire(document, 'pointerup', 502)
    fire(canvas, 'click', 502)
    expect(clicks()).toBe(1)
    expect(scroller.scrollLeft).toBe(200)
  })

  it('左欄上按下、非主鍵都不平移', () => {
    const { scroller, canvas, left } = setup()
    fire(left, 'pointerdown', 500)
    fire(document, 'pointermove', 400)
    expect(scroller.scrollLeft).toBe(200)
    fire(document, 'pointerup', 400)
    fire(canvas, 'pointerdown', 500, { button: 2 })
    fire(document, 'pointermove', 400)
    expect(scroller.scrollLeft).toBe(200)
  })
})
