import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoScroll, type AutoScroll, type AutoScrollTargets } from '@/composables/useAutoScroll'

/**
 * 拖曳到邊緣時的自動捲動（legacy `autoScrollTick` :2437-2482）。
 * 速度曲線：距邊緣 72px 內開始捲，越近越快，每幀上限 18px；中央為 0。
 */

const EDGE = 72
const MAX = 18

/** 攔下 rAF，測試自己決定跑幾幀。 */
let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 造一顆可捲動的容器：rect 與 scrollLeft / scrollTop 都自己接管（jsdom 沒有版面）。 */
function box(rect: Partial<DOMRect>, size?: { scrollH: number; clientH: number }): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, ...rect }) as DOMRect
  let sl = 0
  let st = 0
  Object.defineProperty(el, 'scrollLeft', { get: () => sl, set: (v: number) => void (sl = v) })
  Object.defineProperty(el, 'scrollTop', { get: () => st, set: (v: number) => void (st = v) })
  if (size) {
    Object.defineProperty(el, 'scrollHeight', { value: size.scrollH })
    Object.defineProperty(el, 'clientHeight', { value: size.clientH })
  }
  return el
}

/** 在元件內建立 auto scroll，並跑指定幀數。 */
function mountAuto(targets: AutoScrollTargets): { auto: AutoScroll; step: () => void } {
  let auto!: AutoScroll
  const Host = defineComponent({
    setup() {
      auto = useAutoScroll(targets)
      return () => h('div')
    },
  })
  mount(Host)
  return {
    auto,
    step: () => {
      const cb = frames.pop()
      cb?.(0)
    },
  }
}

describe('useAutoScroll 的速度曲線', () => {
  it('指標在容器中央：不捲、也不通知呼叫端', () => {
    const sc = box({ left: 0, right: 1000 })
    const onScrolled = vi.fn()
    const { auto, step } = mountAuto({
      pointer: () => ({ x: 500, y: 400 }),
      horizontal: () => sc,
      vertical: () => null,
      onScrolled,
    })
    auto.start()
    step()
    expect(sc.scrollLeft).toBe(0)
    expect(onScrolled).not.toHaveBeenCalled()
    auto.stop()
  })

  it('左緣 72px 內：往左捲，速度與距離成正比', () => {
    const sc = box({ left: 0, right: 1000 })
    const onScrolled = vi.fn()
    const x = 10
    const { auto, step } = mountAuto({
      pointer: () => ({ x, y: 400 }),
      horizontal: () => sc,
      vertical: () => null,
      onScrolled,
    })
    sc.scrollLeft = 500
    auto.start()
    step()
    expect(sc.scrollLeft).toBe(500 - (Math.min(1, (EDGE - x) / EDGE) * MAX))
    expect(onScrolled).toHaveBeenCalledTimes(1)
    auto.stop()
  })

  it('右緣外側：往右捲且每幀不超過 18px', () => {
    const sc = box({ left: 0, right: 1000 })
    const { auto, step } = mountAuto({
      pointer: () => ({ x: 1200, y: 400 }),
      horizontal: () => sc,
      vertical: () => null,
      onScrolled: () => {},
    })
    auto.start()
    step()
    expect(sc.scrollLeft).toBe(MAX)
    auto.stop()
  })

  it('垂直：容器捲得動就捲容器，靠近上緣往回捲', () => {
    const vs = box({ top: 100, bottom: 700 }, { scrollH: 2000, clientH: 600 })
    vs.scrollTop = 300
    const { auto, step } = mountAuto({
      pointer: () => ({ x: 0, y: 130 }),
      horizontal: () => null,
      vertical: () => vs,
      onScrolled: () => {},
    })
    auto.start()
    step()
    // pos=130、min=100 → -(72-30)/72*18
    expect(vs.scrollTop).toBe(300 - (Math.min(1, (100 + EDGE - 130) / EDGE) * MAX))
    auto.stop()
  })

  it('stop() 之後不再排下一幀', () => {
    const sc = box({ left: 0, right: 1000 })
    const { auto } = mountAuto({
      pointer: () => ({ x: 0, y: 400 }),
      horizontal: () => sc,
      vertical: () => null,
      onScrolled: () => {},
    })
    auto.start()
    expect(frames).toHaveLength(1)
    auto.stop()
    frames.length = 0
    auto.start()
    expect(frames).toHaveLength(1)
    auto.stop()
  })
})
