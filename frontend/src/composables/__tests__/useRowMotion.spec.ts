import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRowMotion, type RowMotion } from '@/composables/useRowMotion'

/**
 * 甘特列的上下位移補間：列 index 變了，它的所有元素先移回舊位置再補間回 0；
 * 中斷時從「畫面上此刻的位置」接著走；同一列 key 的元素（左欄列與右側條）永遠拿到同一個位移。
 */

const ROW = 34
/** 測試用的時間函式：線性、200ms，算數好驗。 */
const TIMING = { duration: 200, ease: (x: number) => x }

/** 攔下 rAF，每一幀由測試自己推（帶時間戳）。 */
let frames: FrameRequestCallback[] = []
let clock = 0
function runFrame(ts: number): void {
  clock = ts
  const due = frames
  frames = []
  for (const cb of due) cb(ts)
}
/** 從目前時間起每 16ms 推一幀，推 n 幀。 */
function runFrames(n: number): void {
  for (let i = 0; i < n; i++) runFrame(clock + 16)
}

beforeEach(() => {
  frames = []
  clock = 1000
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 每個 key 兩顆元素（模擬左欄列與右側條），順便驗左右是否拿到同一個位移。 */
function mountMotion(initial: string[], timing = TIMING) {
  const keys = ref(initial)
  const els = new Map<string, HTMLElement[]>()
  const elementsOf = (key: string): HTMLElement[] => {
    let pair = els.get(key)
    if (!pair) {
      pair = [document.createElement('div'), document.createElement('div')]
      els.set(key, pair)
    }
    return pair
  }
  let motion!: RowMotion
  const Host = defineComponent({
    setup() {
      motion = useRowMotion({ keys: () => keys.value, elementsOf, rowHeight: ROW, timing: () => timing })
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  /** 某個 key 目前寫上去的位移（px）；沒有 translate 回 0。 */
  const offsetOf = (key: string): number => {
    const [a, b] = elementsOf(key)
    expect(a!.style.translate).toBe(b!.style.translate)
    const m = /^0(?:px)? (-?[\d.]+)px$/.exec(a!.style.translate)
    return m ? parseFloat(m[1]!) : 0
  }
  return { keys, motion, offsetOf, unmount: () => wrapper.unmount() }
}

describe('useRowMotion', () => {
  it('列往上移兩格：當下先移回舊位置，第一幀畫在起點，補間跑完回到 0 並清掉 translate', async () => {
    const { keys, offsetOf, motion } = mountMotion(['g1', 't1', 't2', 'g2', 't7'])
    // 收合 g1：t1、t2 離場，g2 與 t7 往上兩格
    keys.value = ['g1', 'g2', 't7']
    await nextTick()
    expect(offsetOf('g2')).toBe(2 * ROW)
    expect(offsetOf('t7')).toBe(2 * ROW)
    expect(motion.offsets.value.get('t7')).toBe(2 * ROW)
    // g1 沒動
    expect(offsetOf('g1')).toBe(0)

    runFrame(1016)
    expect(offsetOf('t7')).toBe(2 * ROW)
    runFrames(5) // 走了 80ms（線性）→ 剩 60%
    expect(offsetOf('t7')).toBeCloseTo(2 * ROW * 0.6, 1)
    runFrames(8)
    expect(offsetOf('t7')).toBe(0)
    expect(motion.offsets.value.size).toBe(0)
    expect(frames).toHaveLength(0)
  })

  it('補間中又換位置：從畫面上此刻的位置接著走，不跳', async () => {
    const { keys, offsetOf } = mountMotion(['g1', 't1', 't2', 'g2', 't7'])
    keys.value = ['g1', 'g2', 't7']
    await nextTick()
    runFrame(1016)
    runFrames(3) // 走了 48ms → 剩 76%
    const cur = offsetOf('t7')
    expect(cur).toBeCloseTo(68 * 0.76, 1)

    // 80ms 內又展開：t7 回到 index 4，新位置比剛才的新位置低 68px
    keys.value = ['g1', 't1', 't2', 'g2', 't7']
    await nextTick()
    // 畫面上的位置不變：位移 = 目前的位移 − 68
    expect(offsetOf('t7')).toBeCloseTo(cur - 2 * ROW, 1)
    // 新進場的列直接在新位置
    expect(offsetOf('t1')).toBe(0)
    runFrames(20)
    expect(offsetOf('t7')).toBe(0)
  })

  it('一幀卡很久時只推進一小段，不跳掉一大截', async () => {
    const { keys, offsetOf } = mountMotion(['g1', 't1', 't2', 'g2', 't7'])
    keys.value = ['g1', 'g2', 't7']
    await nextTick()
    runFrame(1016)
    runFrame(1116) // 卡了 100ms
    // 最多推進 34ms（線性 17%），不是 100ms（50%）
    expect(offsetOf('t7')).toBeCloseTo(68 * (1 - 34 / 200), 1)
  })

  it('離場的 key 不再寫；沒換位置的 key 不補間', async () => {
    const { keys, offsetOf, motion } = mountMotion(['g1', 't1', 'g2'])
    keys.value = ['g1', 'g2']
    await nextTick()
    expect(offsetOf('g1')).toBe(0)
    expect([...motion.offsets.value.keys()]).toEqual(['g2'])
  })

  it('時長 0（沒有 token 的環境）不補間', async () => {
    const { keys, offsetOf, motion } = mountMotion(['g1', 't1', 'g2'], { duration: 0, ease: (x) => x })
    keys.value = ['g1', 'g2']
    await nextTick()
    expect(offsetOf('g2')).toBe(0)
    expect(motion.offsets.value.size).toBe(0)
    expect(frames).toHaveLength(0)
  })

  it('卸載時停掉迴圈', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { keys, unmount } = mountMotion(['g1', 't1', 'g2'])
    keys.value = ['g1', 'g2']
    await nextTick()
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})
