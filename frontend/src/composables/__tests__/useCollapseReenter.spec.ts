import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCollapseReenter } from '@/composables/useCollapseReenter'

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

  it('一般進場（沒有同 key 離場中）不寫任何 inline', () => {
    const { api } = setup()
    api.snapshot()
    const el = fresh('c')
    api.onEnter(el)
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
})
