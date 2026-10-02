import { describe, expect, it, vi } from 'vitest'
import { freezeLeave } from '@/composables/freezeLeave'
import { FLIP_ID } from '@/lib/transform'

/**
 * TransitionGroup 的離場元素要停在原位淡出：
 * 只設 absolute 會跳到容器內容區起點，所以要連同當下的位置與尺寸一起寫死。
 */
describe('freezeLeave', () => {
  it('把離場元素釘在當下的位置與尺寸', () => {
    const el = document.createElement('div')
    Object.defineProperties(el, {
      offsetTop: { value: 40 },
      offsetLeft: { value: 12 },
      offsetWidth: { value: 300 },
      offsetHeight: { value: 88 },
    })
    freezeLeave(el)
    expect(el.style.position).toBe('absolute')
    expect([el.style.top, el.style.left, el.style.width, el.style.height]).toEqual([
      '40px',
      '12px',
      '300px',
      '88px',
    ])
  })

  it('同一次更新多個元素離場：後面的也釘在自己更新前的位置', async () => {
    const parent = document.createElement('div')
    const kids = [0, 1, 2].map(() => parent.appendChild(document.createElement('div')))
    // 直向堆疊：offsetTop = 前面還在版面流裡（非 absolute）的兄弟數 × 50
    for (const k of kids) {
      Object.defineProperties(k, {
        offsetTop: {
          configurable: true,
          get: () =>
            kids.slice(0, kids.indexOf(k)).filter((s) => s.style.position !== 'absolute').length *
            50,
        },
        offsetLeft: { configurable: true, get: () => 0 },
        offsetWidth: { configurable: true, get: () => 300 },
        offsetHeight: { configurable: true, get: () => 50 },
      })
    }
    freezeLeave(kids[1]!)
    freezeLeave(kids[2]!)
    expect(kids[1]!.style.top).toBe('50px')
    expect(kids[2]!.style.top).toBe('100px')
    await Promise.resolve() // 快取在 microtask 清掉
  })

  it('下一輪更新重新量：快取只留到這一輪的 microtask', async () => {
    const parent = document.createElement('div')
    const kids = [0, 1].map(() => parent.appendChild(document.createElement('div')))
    let shift = 0
    for (const k of kids) {
      Object.defineProperties(k, {
        offsetTop: { configurable: true, get: () => kids.indexOf(k) * 50 + shift },
        offsetLeft: { configurable: true, get: () => 0 },
        offsetWidth: { configurable: true, get: () => 300 },
        offsetHeight: { configurable: true, get: () => 50 },
      })
    }
    freezeLeave(kids[0]!)
    await Promise.resolve()
    shift = 7 // 下一輪之前版面變了
    freezeLeave(kids[1]!)
    expect(kids[1]!.style.top).toBe('57px')
  })

  it('位移中離場：釘在看得到的位置、清掉 inline transform / transition，只取消位移的動畫', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    Object.defineProperties(el, {
      offsetTop: { value: 40 },
      offsetLeft: { value: 12 },
      offsetWidth: { value: 300 },
      offsetHeight: { value: 88 },
    })
    el.style.transition = 'transform 0.26s'
    el.style.transform = 'matrix(1, 0, 0, 1, -30, 5)'
    const move = { transitionProperty: 'transform', cancel: vi.fn() } // 內建 move / 舊 FLIP 的 CSS 過渡
    const flip = { id: FLIP_ID, cancel: vi.fn() } // useRelativeFlip 的 Web Animations
    const fade = { transitionProperty: 'opacity', cancel: vi.fn() } // 離場淡出，要留著
    ;(el as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [move, flip, fade]
    freezeLeave(el)
    expect([el.style.top, el.style.left]).toEqual(['45px', '-18px'])
    expect(el.style.transition).toBe('')
    expect(el.style.transform).toBe('')
    expect(move.cancel).toHaveBeenCalledTimes(1)
    expect(flip.cancel).toHaveBeenCalledTimes(1)
    expect(fade.cancel).not.toHaveBeenCalled()
    el.remove()
  })

  it('淡入中被移除：每一次讀版面與動畫時，inline transition 都已列出全部屬性，讀完清掉', async () => {
    const parent = document.createElement('div')
    const kids = [0, 1].map(() => parent.appendChild(document.createElement('div')))
    // 記下每次讀的當下元素的 inline transition：讀版面 / 動畫會逼瀏覽器重算樣式，清單沒列到的進行中過渡就被取消
    const seen: string[] = []
    for (const k of kids) {
      Object.defineProperties(k, {
        offsetTop: {
          configurable: true,
          get: () => (seen.push(k.style.transition), kids.indexOf(k) * 50),
        },
        offsetLeft: { configurable: true, get: () => 0 },
        offsetWidth: { configurable: true, get: () => 300 },
        offsetHeight: { configurable: true, get: () => 50 },
      })
      ;(k as unknown as { getAnimations: () => unknown[] }).getAnimations = () => (
        seen.push(k.style.transition),
        []
      )
    }
    // 同一輪的第一個量完同父層全部子元素；第二個用快取，但讀自己的動畫之前也要先設好
    freezeLeave(kids[0]!)
    seen.length = 0
    freezeLeave(kids[1]!)
    expect(seen).toEqual(['all 0s'])
    expect(kids.map((k) => k.style.transition)).toEqual(['', ''])
    await Promise.resolve()
  })

  it('量同父層時，正在離場的這一個也已先設好 inline transition', async () => {
    const parent = document.createElement('div')
    const el = parent.appendChild(document.createElement('div'))
    let during = ''
    Object.defineProperty(el, 'offsetTop', {
      configurable: true,
      get: () => ((during = el.style.transition), 0),
    })
    freezeLeave(el)
    expect(during).toBe('all 0s')
    expect(el.style.transition).toBe('')
    await Promise.resolve()
  })

  it('只有縮放的 transform 過渡（進場的 scale）留著接續；有位移的、讀不到 keyframes 的照樣取消', () => {
    const el = document.createElement('div')
    const kf = (from: string) => ({
      getKeyframes: () => [{ transform: from }, { transform: 'none' }],
    })
    const scale = { transitionProperty: 'transform', effect: kf('scale(0.96)'), cancel: vi.fn() }
    const move = {
      transitionProperty: 'transform',
      effect: kf('translate(12px, 0px)'),
      cancel: vi.fn(),
    }
    const matrix = {
      transitionProperty: 'transform',
      effect: kf('matrix(1, 0, 0, 1, 0, -4)'),
      cancel: vi.fn(),
    }
    const rise = {
      transitionProperty: 'transform',
      effect: kf('translateY(-4px)'),
      cancel: vi.fn(),
    }
    const bare = { transitionProperty: 'transform', effect: null, cancel: vi.fn() }
    ;(el as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [
      scale,
      move,
      matrix,
      rise,
      bare,
    ]
    freezeLeave(el)
    expect(scale.cancel).not.toHaveBeenCalled()
    for (const a of [move, matrix, rise, bare]) expect(a.cancel).toHaveBeenCalledTimes(1)
  })

  it('有給 rectOf 就用它（呼叫端在 DOM 更新前量的）', () => {
    const el = document.createElement('div')
    Object.defineProperties(el, {
      offsetTop: { value: 999 },
      offsetLeft: { value: 999 },
      offsetWidth: { value: 1 },
      offsetHeight: { value: 1 },
    })
    freezeLeave(el, () => ({ top: 10, left: 20, width: 300, height: 140 }))
    expect([el.style.top, el.style.left, el.style.width, el.style.height]).toEqual([
      '10px',
      '20px',
      '300px',
      '140px',
    ])
  })
})
