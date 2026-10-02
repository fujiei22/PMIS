import type { VNode } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLeaveNow, useCollapseReenter } from '@/composables/useCollapseReenter'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** 清單容器 > 外層 [data-k] > 裁切層 > 內容（同 CardBoard 的 .board > .lane-wrap > .lane-clip > .lane）。 */
function item(key: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-k', key)
  el.innerHTML = '<div class="clip"><div class="inner"></div></div>'
  return el
}

function setup() {
  const box = document.createElement('div')
  box.append(item('a'), item('b'))
  document.body.appendChild(box)
  return { box, api: useCollapseReenter(box, 'data-k') }
}

/** 新進場的元素：內容完整高度 150。 */
function fresh(key: string): HTMLElement {
  const el = item(key)
  Object.defineProperty(el.querySelector('.inner'), 'offsetHeight', { value: 150 })
  return el
}

describe('useCollapseReenter', () => {
  it('同 key 在離場中又回來：新元素先關過渡、以舊元素當下的高度比例與透明度算一次樣式，再立刻放開往回長（不等兩幀）', () => {
    vi.useFakeTimers()
    const { box, api } = setup()
    const old = box.querySelector('[data-k="b"]') as HTMLElement
    old.classList.add('ov-col-leave-active')
    old.style.opacity = '0.4' // jsdom 的 computed opacity 讀 inline：當下的透明度
    old.getBoundingClientRect = () => ({ height: 60 }) as DOMRect
    api.snapshot() // 清單更新前（TransitionGroup 的 before-update）：量到 b 的 60px / 0.4
    // 新元素的 beforeEnter 裡 Vue 先把離場中的舊元素提早移除：已不在 DOM 上，但 *-leave-active 還在（實測）
    old.remove()
    const el = fresh('b')
    el.classList.add('ov-col-enter-from', 'ov-col-enter-active') // Vue 的 beforeEnter 已加上
    // 強制算樣式（讀 offsetHeight）那一刻的 inline：起點要在關掉過渡時生效
    const atReflow: string[] = []
    Object.defineProperty(el, 'offsetHeight', {
      get: () => {
        atReflow.push(`${el.style.transition}|${el.style.gridTemplateRows}|${el.style.opacity}`)
        return 0
      },
    })
    api.onEnter(el)
    expect(atReflow).toEqual(['none|0.4fr|0.4'])
    // 立刻放開：交還 class 的過渡、拿掉 enter-from（目標直接是 1fr / 1），清掉 inline——下一次算樣式就從起點往回長
    expect(el.style.cssText).toBe('')
    expect(el.classList.contains('ov-col-enter-from')).toBe(false)
    expect(el.classList.contains('ov-col-enter-active')).toBe(true)
    // 不再排兩幀後的放開
    expect(vi.getTimerCount()).toBe(0)
  })

  it('一般進場（沒有同 key 離場中）：當下就拿掉 enter-from 讓長出起步（先以 enter-from 算一次樣式當起點），不寫 inline', () => {
    const { api } = setup()
    api.snapshot()
    const el = fresh('c')
    el.classList.add('ov-col-enter-from', 'ov-col-enter-active')
    /** 讀樣式的當下有沒有 enter-from（起點要是 0fr、透明）。 */
    const seen: boolean[] = []
    const real = window.getComputedStyle.bind(window)
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((e, pseudo) => {
      if (e === el) seen.push(el.classList.contains('ov-col-enter-from'))
      return real(e, pseudo)
    })
    api.onEnter(el)
    spy.mockRestore()
    expect(seen).toEqual([true])
    expect(el.classList.contains('ov-col-enter-from')).toBe(false)
    expect(el.classList.contains('ov-col-enter-active')).toBe(true)
    expect(el.getAttribute('style')).toBeNull()
  })

  it('只記離場中的項目：同 key 但沒在離場（沒有 *-leave-active）不算', () => {
    const { box, api } = setup()
    const b = box.querySelector('[data-k="b"]') as HTMLElement
    b.style.opacity = '0.4'
    api.snapshot()
    const el = fresh('b')
    api.onEnter(el)
    expect(el.getAttribute('style')).toBeNull()
  })

  it('過期的快照不用：量的時候在離場、之後已自己收完（*-leave-active 已拿掉、移除）才又進場，照一般進場從 0 長', () => {
    const { box, api } = setup()
    const old = box.querySelector('[data-k="b"]') as HTMLElement
    old.classList.add('ov-col-leave-active')
    old.style.opacity = '0.4'
    old.getBoundingClientRect = () => ({ height: 60 }) as DOMRect
    api.snapshot()
    // 這次更新 b 沒有回來；之後舊的 b 自己收完：Vue 先拿掉離場 class、再移除
    old.classList.remove('ov-col-leave-active')
    old.remove()
    const el = fresh('b')
    el.classList.add('ov-col-enter-from', 'ov-col-enter-active')
    api.onEnter(el)
    // 沒寫起點（inline 都沒有）：照一般進場從 enter-from（0fr、透明）長
    expect(el.getAttribute('style')).toBeNull()
    expect(el.classList.contains('ov-col-enter-active')).toBe(true)
  })

  it('量到的只用一次：同一個 key 下一次進場照一般進場', () => {
    const { box, api } = setup()
    const old = box.querySelector('[data-k="b"]') as HTMLElement
    old.classList.add('ov-col-leave-active')
    old.getBoundingClientRect = () => ({ height: 60 }) as DOMRect
    api.snapshot()
    api.onEnter(fresh('b'))
    const again = fresh('b')
    api.onEnter(again)
    expect(again.getAttribute('style')).toBeNull()
  })

  it('startLeaveNow：離場當下就把 *-leave-from 換成 *-leave-to（收合與換順序的 move 同一幀開始），其他 class 不動、不寫 inline', () => {
    const el = item('a')
    el.classList.add('ov-col-leave-from', 'ov-col-leave-active')
    startLeaveNow(el)
    expect(Array.from(el.classList)).toEqual(['ov-col-leave-active', 'ov-col-leave-to'])
    expect(el.getAttribute('style')).toBeNull()
    // Vue 之後在 nextFrame 再換一次是空操作；沒有 leave-from 時什麼都不做
    startLeaveNow(el)
    expect(Array.from(el.classList)).toEqual(['ov-col-leave-active', 'ov-col-leave-to'])
  })

  describe('resume：進場中被換順序（keyed diff 搬動 DOM 取消進行中的過渡）', () => {
    /** 進場中的項目：高度 h、透明度 o，高度過渡已跑 t ms（時長 260、線性），內容完整高度 150。 */
    function entering(h: number, o: number, t: number) {
      const { box, api } = setup()
      const el = box.querySelector('[data-k="b"]') as HTMLElement
      el.classList.add('ov-col-enter-active', 'ov-col-enter-to')
      el.style.opacity = String(o)
      el.getBoundingClientRect = () => ({ height: h }) as DOMRect
      Object.defineProperty(el.querySelector('.inner'), 'offsetHeight', { value: 150 })
      const anim = {
        transitionProperty: 'grid-template-rows',
        playState: 'running',
        currentTime: t,
        effect: { getTiming: () => ({ duration: 260, easing: 'linear' }) },
      }
      el.getAnimations = () => [anim as unknown as Animation]
      api.snapshot()
      el.style.opacity = '' // 被搬動：當幀跳到全亮
      /** 每次強制算樣式那一刻的 inline：transition | grid-template-rows | opacity | transition-delay */
      const atReflow: string[] = []
      Object.defineProperty(el, 'offsetHeight', {
        get: () => {
          atReflow.push(`${el.style.transition}|${el.style.gridTemplateRows}|${el.style.opacity}|${el.style.transitionDelay}`)
          return 0
        },
      })
      return { el, api, anim, atReflow }
    }

    it('高度過渡被取消了：以負的 delay 從原本的進度接續、在原本的時間結束；起點反推成照同一條曲線在這個進度時正好是當下的值', () => {
      // 高度 90 / 150 = 0.6、透明度 0.7；線性曲線跑了 104 / 260 = 0.4 → 起點 (0.6 − 0.4) / 0.6 = 1/3、(0.7 − 0.4) / 0.6 = 0.5
      const { el, api, anim, atReflow } = entering(90, 0.7, 104)
      anim.playState = 'idle'
      api.resume(el)
      expect(atReflow).toHaveLength(2)
      const [t0, g0, o0] = atReflow[0]!.split('|')
      expect(t0).toBe('none')
      expect(parseFloat(g0!)).toBeCloseTo(1 / 3, 5)
      expect(parseFloat(o0!)).toBeCloseTo(0.5, 5)
      // 交還過渡、清掉起點，帶著負的 delay 重建過渡
      expect(atReflow[1]).toBe('|||-104ms')
      // 過渡建立後拿掉 delay：不留任何 inline
      expect(el.style.cssText).toBe('')
    })

    it('從 0 長的（沒被打斷過）：起點就是 0', () => {
      const { el, api, anim, atReflow } = entering(60, 0.4, 104)
      anim.playState = 'idle'
      api.resume(el)
      expect(atReflow[0]).toBe('none|0fr|0|')
    })

    it('沒被搬動（高度過渡照跑）不碰；綁 @vue:updated 時傳進來的是 vnode 也認得', () => {
      const { el, api, atReflow } = entering(90, 0.7, 104)
      api.resume({ el } as unknown as VNode)
      expect(atReflow).toHaveLength(0)
      expect(el.getAttribute('style')).toBe('')
    })

    it('被搬動、傳 vnode：照樣接續', () => {
      const { el, api, anim, atReflow } = entering(90, 0.7, 104)
      anim.playState = 'idle'
      api.resume({ el } as unknown as VNode)
      expect(atReflow).toHaveLength(2)
    })

    it('已經不在進場中（Vue 收尾拿掉了 enter-active）不碰', () => {
      const { el, api, anim, atReflow } = entering(90, 0.7, 104)
      anim.playState = 'idle'
      el.classList.remove('ov-col-enter-active', 'ov-col-enter-to')
      api.resume(el)
      expect(atReflow).toHaveLength(0)
    })
  })
})
