import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  provideDomRegistry,
  registerEl,
  registerPair,
  useDomRegistry,
  type DomRegistry,
  type ElPair,
} from '@/composables/useDomRegistry'

/** 等一輪 microtask：解除登錄是 `queueMicrotask` 排的。 */
const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()))

/** 造一顆真的掛進文件的元素（`isConnected` 才會是 true）。 */
function attached(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('useDomRegistry（契約 F、review F10）', () => {
  it('provide 過的登錄表由底下的元件 inject 到同一份', () => {
    let provided!: DomRegistry
    let injected!: DomRegistry
    const Inner = defineComponent({
      setup() {
        injected = useDomRegistry()
        return () => h('div')
      },
    })
    const Host = defineComponent({
      setup() {
        provided = provideDomRegistry()
        return () => h(Inner)
      },
    })
    const wrapper = mount(Host)
    expect(injected).toBe(provided)
    wrapper.unmount()
  })

  describe('registerEl', () => {
    it('同一張表、同一個 id 回同一顆函式', () => {
      const map = new Map<string, HTMLElement>()
      const other = new Map<string, HTMLElement>()
      expect(registerEl(map, 't1')).toBe(registerEl(map, 't1'))
      expect(registerEl(map, 't1')).not.toBe(registerEl(map, 't2'))
      expect(registerEl(map, 't1')).not.toBe(registerEl(other, 't1'))
    })

    it('同 id 重新掛載：新的先進來，舊的 null 不會把它刪掉', async () => {
      const map = new Map<string, HTMLElement>()
      const set = registerEl(map, 't1')
      const fresh = attached()

      set(fresh)
      // 舊元素卸載時 Vue 才送 null（順序一定在新的 set 之後）
      set(null)
      await tick()

      expect(map.get('t1')).toBe(fresh)
      fresh.remove()
    })

    it('microtask 之後確實離開文件了才刪', async () => {
      const map = new Map<string, HTMLElement>()
      const set = registerEl(map, 't1')
      const el = attached()

      set(el)
      set(null)
      await tick()
      // 還在文件裡（只是 Vue 換了一次 ref）→ 不刪
      expect(map.get('t1')).toBe(el)

      el.remove()
      set(null)
      await tick()
      expect(map.has('t1')).toBe(false)
    })
  })

  describe('registerPair', () => {
    it('同一個 id 回同一組函式', () => {
      const map = new Map<string, ElPair>()
      expect(registerPair(map, 't1')).toBe(registerPair(map, 't1'))
      expect(registerPair(map, 't1')).not.toBe(registerPair(map, 't2'))
    })

    it('兩顆都到齊才登錄成一組', () => {
      const map = new Map<string, ElPair>()
      const refs = registerPair(map, 't1')
      const l = attached()
      const r = attached()

      refs.L(l)
      expect(map.has('t1')).toBe(false)
      refs.R(r)
      expect(map.get('t1')).toEqual({ L: l, R: r })
      l.remove()
      r.remove()
    })

    it('離開文件後才解除登錄，重新掛載不誤刪', async () => {
      const map = new Map<string, ElPair>()
      const refs = registerPair(map, 't1')
      const l = attached()
      const r = attached()
      refs.L(l)
      refs.R(r)

      // 重新掛載：新的兩顆先進來，舊的 null 才到
      const l2 = attached()
      const r2 = attached()
      refs.L(l2)
      refs.R(r2)
      refs.L(null)
      refs.R(null)
      await tick()
      expect(map.get('t1')).toEqual({ L: l2, R: r2 })

      l2.remove()
      r2.remove()
      refs.L(null)
      refs.R(null)
      await tick()
      expect(map.has('t1')).toBe(false)

      l.remove()
      r.remove()
    })
  })
})
