import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRelativeFlip } from '@/composables/useRelativeFlip'
import { FLIP_ID } from '@/lib/transform'

/**
 * 相對於容器的 FLIP：jsdom 沒有版面，offsetTop 用「在容器裡排第幾個 × 50px」模擬直向堆疊的清單。
 * 驗：換了位置的元素用 Web Animations 從看得到的舊位置補間回來、不寫 inline transition；
 * 位置沒變、新進場的元素不動；位移中又重排時先取消上一段；snapshotOf 回傳更新前的位置。
 */

/** offsetTop = 在父層裡的順序 × 50，模擬一張直向清單。 */
function fakeLayout(el: HTMLElement): void {
  Object.defineProperty(el, 'offsetTop', {
    configurable: true,
    get: () => Array.from(el.parentElement?.children ?? []).indexOf(el) * 50,
  })
  Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => 0 })
}

/** 時長直接給毫秒：不依賴 jsdom 讀 CSS 自訂屬性（時長為 0 時實作不呼叫 animate）。 */
function setup(initial: string[]) {
  const keys = ref(initial)
  const Comp = defineComponent({
    setup() {
      const box = ref<HTMLElement | null>(null)
      useRelativeFlip(box, 'data-k', 260)
      return () =>
        h(
          'div',
          { ref: box },
          keys.value.map((k) =>
            h('div', { key: k, 'data-k': k, ref: (el) => el && fakeLayout(el as HTMLElement) }),
          ),
        )
    },
  })
  return { w: mount(Comp), keys }
}

const styleOf = (w: ReturnType<typeof setup>['w'], k: string): CSSStyleDeclaration =>
  (w.find(`[data-k="${k}"]`).element as HTMLElement).style

// jsdom 沒有 Web Animations：把 animate / getAnimations 換成記錄用的替身。
type Call = { el: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions }
let calls: Call[] = []
let running = new Map<HTMLElement, { id: string; cancel: () => void }[]>()
beforeEach(() => {
  calls = []
  running = new Map()
  HTMLElement.prototype.animate = function (this: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, opts })
    const a = { id: String(opts.id ?? ''), cancel: vi.fn() }
    running.set(this, [...(running.get(this) ?? []), a])
    return a as unknown as Animation
  } as HTMLElement['animate']
  HTMLElement.prototype.getAnimations = function (this: HTMLElement) {
    return (running.get(this) ?? []) as unknown as Animation[]
  }
})
afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations
})
const callOf = (w: ReturnType<typeof setup>['w'], k: string): Call[] =>
  calls.filter((c) => c.el === w.find(`[data-k="${k}"]`).element)

describe('useRelativeFlip', () => {
  it('換了位置的元素：用 Web Animations 從舊位置補間回新位置（疊加、不寫 inline）', async () => {
    const { w, keys } = setup(['a', 'b'])
    keys.value = ['b', 'a']
    await nextTick()
    const [a] = callOf(w, 'a')
    expect(a!.frames).toEqual([{ transform: 'translate(0px, -50px)' }, { transform: 'translate(0px, 0px)' }])
    expect(a!.opts).toMatchObject({ composite: 'add', id: FLIP_ID })
    expect(callOf(w, 'b')[0]!.frames[0]).toEqual({ transform: 'translate(0px, 50px)' })
    for (const k of ['a', 'b']) expect(styleOf(w, k).transition).toBe('')
  })

  it('位置沒變與新進場的元素不動', async () => {
    const { w, keys } = setup(['a', 'b'])
    keys.value = ['a', 'b', 'c']
    await nextTick()
    for (const k of ['a', 'b', 'c']) expect(callOf(w, k)).toHaveLength(0)
  })

  it('進場中的元素被重排：不寫 inline transition（opacity、高度的進場過渡照跑）', async () => {
    const { w, keys } = setup(['a', 'b'])
    ;(w.find('[data-k="a"]').element as HTMLElement).classList.add('ov-card-enter-active')
    keys.value = ['b', 'a']
    await nextTick()
    expect(callOf(w, 'a')).toHaveLength(1)
    expect(styleOf(w, 'a').transition).toBe('')
  })

  it('位移中又重排：起點用看得到的位置，並先取消上一段 FLIP', async () => {
    const { w, keys } = setup(['a', 'b'])
    const b = w.find('[data-k="b"]').element as HTMLElement
    const old = { id: FLIP_ID, cancel: vi.fn() }
    running.set(b, [old])
    b.style.transform = 'matrix(1, 0, 0, 1, 0, -20)' // 看得到的位置是 50 - 20 = 30（jsdom 用 inline 模擬動畫中的 transform）
    keys.value = ['b', 'a'] // b 的版面位置變 0
    await nextTick()
    expect(old.cancel).toHaveBeenCalledTimes(1)
    expect(callOf(w, 'b')[0]!.frames[0]).toEqual({ transform: 'translate(0px, 30px)' })
  })

  it('位移中、版面位置沒變的更新（打字但篩選結果不變）：上一段 FLIP 照跑，不從 0 速重新起跳', async () => {
    const { w, keys } = setup(['a', 'b'])
    const b = w.find('[data-k="b"]').element as HTMLElement
    const old = { id: FLIP_ID, cancel: vi.fn() }
    running.set(b, [old])
    b.style.transform = 'matrix(1, 0, 0, 1, 0, -20)' // 還在往版面位置 50 補間的途中
    keys.value = ['a', 'b'] // 重新渲染，順序不變
    await nextTick()
    expect(old.cancel).not.toHaveBeenCalled()
    expect(callOf(w, 'b')).toHaveLength(0)
  })

  it('snapshotOf：回傳更新前的位置（給 freezeLeave 用）', async () => {
    let api!: ReturnType<typeof useRelativeFlip>
    const keys = ref(['a', 'b'])
    const w = mount(
      defineComponent({
        setup() {
          const box = ref<HTMLElement | null>(null)
          api = useRelativeFlip(box, 'data-k', 260)
          return () =>
            h(
              'div',
              { ref: box },
              keys.value.map((k) => h('div', { key: k, 'data-k': k, ref: (el) => el && fakeLayout(el as HTMLElement) })),
            )
        },
      }),
    )
    const b = w.find('[data-k="b"]').element
    keys.value = ['a']
    await nextTick()
    expect(api.snapshotOf(b)?.top).toBe(50)
  })
})
