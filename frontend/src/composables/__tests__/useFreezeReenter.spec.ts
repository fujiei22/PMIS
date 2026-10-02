import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, onBeforeUpdate, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFreezeReenter } from '@/composables/useFreezeReenter'
import { FLIP_ID } from '@/lib/transform'

/**
 * 釘位離場的清單：同 key 在離場中又回來時，新元素從舊元素當下看得到的位置、透明度與縮放接續。
 * jsdom 沒有版面與 TransitionGroup：offsetTop 用「在容器裡排第幾個 × 50px」模擬直向清單；
 * 離場中的舊元素由測試自己掛進容器（帶 *-leave-active、釘住的 offset），更新時在量完之後移除（同 Vue 在新元素 beforeEnter 時提早移除）；
 * 回來的新元素帶著 Vue beforeEnter 會加的 enter-from / enter-active。
 */

/** offsetTop = 在父層裡的順序 × 50，模擬一張直向清單。 */
function fakeLayout(el: HTMLElement): void {
  Object.defineProperty(el, 'offsetTop', {
    configurable: true,
    get: () => Array.from(el.parentElement?.children ?? []).indexOf(el) * 50,
  })
  Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => 0 })
}

/** freezeLeave 釘住的離場元素：釘在 top / left，當下的透明度與縮放寫 inline（jsdom 的 computed 讀 inline）。 */
function pinned(
  key: string,
  at: { top: number; left: number },
  look: { o: number; s: number },
): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-k', key)
  el.className = 'ov-card-leave-active ov-card-leave-to'
  el.style.opacity = String(look.o)
  el.style.transform = `scale(${look.s})`
  Object.defineProperty(el, 'offsetTop', { value: at.top })
  Object.defineProperty(el, 'offsetLeft', { value: at.left })
  return el
}

/** 時長直接給毫秒：不依賴 jsdom 讀 CSS 自訂屬性。 */
function setup(initial: string[]) {
  const keys = ref(initial)
  /** 這次更新要回來的 key：渲染時帶上 enter-from / enter-active。 */
  const entering = ref<string[]>([])
  let box!: HTMLElement
  let ghost: HTMLElement | null = null
  const w = mount(
    defineComponent({
      setup() {
        const el = ref<HTMLElement | null>(null)
        useFreezeReenter(el, 'data-k', 260)
        // 量完之後才移除舊元素（註冊在 useFreezeReenter 之後，hook 依序執行）
        onBeforeUpdate(() => {
          ghost?.remove()
          ghost = null
        })
        return () =>
          h(
            'div',
            { ref: el },
            keys.value.map((k) =>
              h('div', {
                key: k,
                'data-k': k,
                class: entering.value.includes(k)
                  ? 'ov-card-enter-from ov-card-enter-active'
                  : undefined,
                ref: (n) => {
                  if (!n) return
                  box = (n as HTMLElement).parentElement!
                  fakeLayout(n as HTMLElement)
                },
              }),
            ),
          )
      },
    }),
    { attachTo: document.body },
  )
  /** 把 key 從清單拿掉，換成一個釘住的離場元素（掛在容器最後，同 freezeLeave 的 absolute 不佔位）。 */
  async function leave(
    key: string,
    at: { top: number; left: number },
    look: { o: number; s: number },
  ) {
    keys.value = keys.value.filter((k) => k !== key)
    await nextTick()
    ghost = pinned(key, at, look)
    box.appendChild(ghost)
  }
  /** key 回來：Vue 會讓它帶著 enter-from / enter-active 進場。 */
  async function comeBack(next: string[], key: string) {
    entering.value = [key]
    keys.value = next
    await nextTick()
    return w.find(`[data-k="${key}"]`).element as HTMLElement
  }
  return { w, keys, leave, comeBack }
}

// jsdom 沒有 Web Animations：把 animate / getAnimations 換成記錄用的替身。
type Call = { el: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions }
let calls: Call[] = []
beforeEach(() => {
  calls = []
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    frames: Keyframe[],
    opts: KeyframeAnimationOptions,
  ) {
    calls.push({ el: this, frames, opts })
    return { id: String(opts.id ?? ''), cancel: vi.fn() } as unknown as Animation
  } as HTMLElement['animate']
  HTMLElement.prototype.getAnimations = () => []
})
afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** 記下強制算樣式（getComputedStyle 讀屬性）那一刻 el 的 inline：起點要在關掉過渡時生效。 */
function watchReflow(): { of: (el: Element) => string[] } {
  const seen = new Map<Element, string[]>()
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const cs = real(el, pseudo)
    return new Proxy(cs, {
      get(t, p) {
        if (p === 'opacity')
          seen.set(el, [...(seen.get(el) ?? []), (el as HTMLElement).style.cssText])
        const v = Reflect.get(t, p, t) as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
      },
    })
  })
  return { of: (el) => seen.get(el) ?? [] }
}

describe('useFreezeReenter', () => {
  it('同 key 在淡出途中、原地回來：從舊元素當下的透明度與縮放接續（CSS 過渡），立刻放開、不播位移', async () => {
    const { leave, comeBack } = setup(['a', 'b'])
    await leave('b', { top: 50, left: 0 }, { o: 0.4, s: 0.98 }) // 釘在原本的第二格
    const reflow = watchReflow()
    const b = await comeBack(['a', 'b'], 'b')
    // 關掉過渡、拿掉 enter-from 之後寫起點並算一次樣式
    expect(reflow.of(b)).toEqual(['transition: none; opacity: 0.4; transform: scale(0.98);'])
    // 交還 class 的過渡、清掉 inline：目標是 enter-active 底下的 1 / 原尺寸，下一次算樣式就從起點過渡
    expect(b.style.cssText).toBe('')
    expect(b.className).toBe('ov-card-enter-active')
    expect(calls).toHaveLength(0) // 位置沒變
  })

  it('舊元素釘在別處（移動途中被篩掉）：另播一段 FLIP，從釘住的位置與縮放補間回自己的格子', async () => {
    const { leave, comeBack } = setup(['a', 'b'])
    await leave('b', { top: 120, left: 30 }, { o: 0.6, s: 0.97 })
    const b = await comeBack(['a', 'b'], 'b') // 版面位置：top 50、left 0
    expect(b.style.cssText).toBe('')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.el).toBe(b)
    expect(calls[0]!.frames).toEqual([
      { transform: 'translate(30px, 70px) scale(0.97)' },
      { transform: 'translate(0px, 0px) scale(1)' },
    ])
    expect(calls[0]!.opts).toMatchObject({ composite: 'add', id: FLIP_ID, duration: 260 })
  })

  it('一般進場（沒有同 key 離場中）不動：不寫 inline、不拿 enter-from、不播動畫', async () => {
    const { comeBack } = setup(['a'])
    const c = await comeBack(['a', 'c'], 'c')
    expect(c.style.cssText).toBe('')
    expect(c.classList.contains('ov-card-enter-from')).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('離場中、這次沒有回來：量到的不留到下一次（下一次更新重新量）', async () => {
    const { keys, leave, comeBack } = setup(['a', 'b', 'c'])
    await leave('b', { top: 50, left: 0 }, { o: 0.4, s: 0.98 })
    keys.value = ['a'] // 另一次更新：b 沒回來（舊元素也在這次被移除，同離場結束）
    await nextTick()
    const b = await comeBack(['a', 'b'], 'b') // 這時已經沒有離場中的 b：照一般進場
    expect(b.style.cssText).toBe('')
    expect(b.classList.contains('ov-card-enter-from')).toBe(true)
  })
})
