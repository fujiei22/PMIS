import { mount } from '@vue/test-utils'
import { defineComponent, h, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { provideDeferredPanels, useDeferredPanels, type DeferredPanels } from '@/composables/useDeferredPanels'
import { notifyPageSettled } from '@/router/pageSwap'

/**
 * 首屏外的面板延後掛載（動畫稽核 K1）：進場過渡跑完＋空閒才一個一個掛；使用者先動手、捷徑 ensure() 立刻掛；
 * 不延後時一開始就全掛。requestIdleCallback 由測試攔下，「空閒」由測試自己推（idle()）。
 */
let idles: (IdleRequestCallback | null)[] = []
/** 攔下的 rAF（等根元素全亮用），由測試自己推。 */
let frames: FrameRequestCallback[] = []

/** 推一個空閒時段：跑最早排進來、還沒取消的那一個。 */
function idle(): void {
  const i = idles.findIndex((cb) => cb)
  if (i < 0) return
  const cb = idles[i]!
  idles[i] = null
  cb({ didTimeout: false, timeRemaining: () => 50 })
}

/** 掛一個 provide 延後面板的外層＋一個 inject 的子元件，回傳兩邊拿到的 API。 */
function host(defer: boolean): { api: DeferredPanels; child: DeferredPanels; unmount: () => void } {
  let api!: DeferredPanels
  let child!: DeferredPanels
  const Child = defineComponent({
    setup() {
      child = useDeferredPanels()
      return () => h('i')
    },
  })
  const Host = defineComponent({
    setup() {
      api = provideDeferredPanels(defer)
      return () => h(Child)
    },
  })
  const w = mount(Host)
  return { api, child, unmount: () => w.unmount() }
}

const both = (p: DeferredPanels): [boolean, boolean] => [p.kanban.value, p.issues.value]

describe('useDeferredPanels', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    idles = []
    frames = []
    vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => idles.push(cb))
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('cancelIdleCallback', (id: number) => void (idles[id - 1] = null))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('不延後：一開始就全掛', () => {
    const { api, unmount } = host(false)
    expect(both(api)).toEqual([true, true])
    unmount()
  })

  it('延後：進場過渡跑完後，空閒時先掛看板、下一個空閒再掛 Issue', () => {
    const { api, unmount } = host(true)
    expect(both(api)).toEqual([false, false])
    vi.advanceTimersByTime(100)
    expect(both(api), '進場還沒跑完：不掛').toEqual([false, false])
    notifyPageSettled()
    expect(both(api), '進場跑完、還沒空閒').toEqual([false, false])
    idle()
    expect(both(api), '第一個空閒：看板').toEqual([true, false])
    idle()
    expect(both(api), '第二個空閒：Issue').toEqual([true, true])
    unmount()
  })

  it('進場結束的通知提早來（Vue 的保險計時器，淡入還在跑）：等根元素真的全亮才排', () => {
    const { api, unmount } = host(true)
    const root = document.createElement('div')
    root.style.opacity = '0.6'
    document.body.appendChild(root)
    notifyPageSettled(root)
    idle()
    expect(both(api), '還在淡入：不排空閒').toEqual([false, false])
    expect(idles.filter(Boolean)).toHaveLength(0)
    root.style.opacity = '1'
    frames.shift()!(performance.now())
    idle()
    expect(both(api), '全亮之後的第一個空閒：看板').toEqual([true, false])
    root.remove()
    unmount()
  })

  it('進場過渡一直沒通知：保險計時器到了照樣排', () => {
    const { api, unmount } = host(true)
    vi.advanceTimersByTime(1499)
    expect(both(api)).toEqual([false, false])
    vi.advanceTimersByTime(1)
    idle()
    idle()
    expect(both(api)).toEqual([true, true])
    unmount()
  })

  it.each(['pointerdown', 'wheel', 'keydown', 'touchstart'])('使用者先動手（%s）：立刻全掛', (type) => {
    const { api, unmount } = host(true)
    window.dispatchEvent(new Event(type))
    expect(both(api)).toEqual([true, true])
    unmount()
  })

  it('捲動不算使用者動手（切頁時 router 自己會捲回頂端）', () => {
    const { api, unmount } = host(true)
    window.dispatchEvent(new Event('scroll'))
    expect(both(api)).toEqual([false, false])
    unmount()
  })

  it('ensure()：立刻全掛，DOM 更新完才 resolve；子元件拿到同一份', async () => {
    const { api, child, unmount } = host(true)
    expect(child.kanban).toBe(api.kanban as Ref<boolean>)
    const p = child.ensure()
    expect(both(api)).toEqual([true, true])
    await expect(p).resolves.toBeUndefined()
    unmount()
  })

  it('卸載後不再排、也不再聽使用者事件', () => {
    const { api, unmount } = host(true)
    unmount()
    notifyPageSettled()
    window.dispatchEvent(new Event('pointerdown'))
    vi.runAllTimers()
    idle()
    idle()
    expect(both(api)).toEqual([false, false])
  })

  it('沒有 provide（單元測試直接掛子元件）：全部視為已掛', async () => {
    let p!: DeferredPanels
    mount(
      defineComponent({
        setup() {
          p = useDeferredPanels()
          return () => h('i')
        },
      }),
    ).unmount()
    expect(both(p)).toEqual([true, true])
    await expect(p.ensure()).resolves.toBeUndefined()
  })
})
