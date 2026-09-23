import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useRelativeFlip } from '@/composables/useRelativeFlip'

/**
 * 相對於容器的 FLIP：jsdom 沒有版面，offsetTop 用「在容器裡排第幾個 × 50px」模擬直向堆疊的清單。
 * 驗兩件事：換了位置的元素會掛上 transform 過渡；位置沒變、新進場的元素不動。
 */

/** offsetTop = 在父層裡的順序 × 50，模擬一張直向清單。 */
function fakeLayout(el: HTMLElement): void {
  Object.defineProperty(el, 'offsetTop', {
    configurable: true,
    get: () => Array.from(el.parentElement?.children ?? []).indexOf(el) * 50,
  })
  Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => 0 })
}

function setup(initial: string[]) {
  const keys = ref(initial)
  const Comp = defineComponent({
    setup() {
      const box = ref<HTMLElement | null>(null)
      useRelativeFlip(box, 'data-k')
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

describe('useRelativeFlip', () => {
  it('換了位置的元素：掛上 transform 過渡，transform 已放開回到新位置', async () => {
    const { w, keys } = setup(['a', 'b'])
    keys.value = ['b', 'a']
    await nextTick()
    for (const k of ['a', 'b']) {
      expect(styleOf(w, k).transition).toContain('transform')
      expect(styleOf(w, k).transform).toBe('')
    }
  })

  it('位置沒變與新進場的元素不動', async () => {
    const { w, keys } = setup(['a', 'b'])
    keys.value = ['a', 'b', 'c']
    await nextTick()
    for (const k of ['a', 'b', 'c']) expect(styleOf(w, k).transition).toBe('')
  })
})
