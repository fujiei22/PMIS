import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { scrollIntoContainer, useFocusRequest, type FocusRequest } from '@/composables/useFocusScroll'
import { sampleProject } from '@/mocks/sampleProject'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'

/** 造一個可控的容器 / 子元素，jsdom 量不到高度就自己餵。 */
function fakePair(opts: {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  elTop: number
  containerTop: number
}): { el: HTMLElement; container: HTMLElement } {
  const container = document.createElement('div')
  Object.defineProperty(container, 'scrollHeight', { value: opts.scrollHeight })
  Object.defineProperty(container, 'clientHeight', { value: opts.clientHeight })
  container.scrollTop = opts.scrollTop
  container.getBoundingClientRect = () => ({ top: opts.containerTop }) as DOMRect
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top: opts.elTop }) as DOMRect
  return { el, container }
}

describe('scrollIntoContainer', () => {
  it('把元素捲到容器頂端下方 pad 的位置', () => {
    const { el, container } = fakePair({
      scrollHeight: 1000,
      clientHeight: 300,
      scrollTop: 100,
      elTop: 250,
      containerTop: 50,
    })
    // delta = 250 - 50 - 20 = 180；100 + 180 = 280
    scrollIntoContainer(el, container, 20)
    expect(container.scrollTop).toBe(280)
  })

  it('夾在 0 與可捲上限之間', () => {
    const up = fakePair({
      scrollHeight: 1000,
      clientHeight: 300,
      scrollTop: 10,
      elTop: 0,
      containerTop: 500,
    })
    scrollIntoContainer(up.el, up.container, 0)
    expect(up.container.scrollTop).toBe(0)

    const down = fakePair({
      scrollHeight: 1000,
      clientHeight: 300,
      scrollTop: 10,
      elTop: 5000,
      containerTop: 0,
    })
    scrollIntoContainer(down.el, down.container, 0)
    expect(down.container.scrollTop).toBe(700)
  })

  it('容器沒得捲就不動', () => {
    const { el, container } = fakePair({
      scrollHeight: 300,
      clientHeight: 300,
      scrollTop: 0,
      elTop: 900,
      containerTop: 0,
    })
    scrollIntoContainer(el, container, 0)
    expect(container.scrollTop).toBe(0)
  })

  it('缺 el 或 container 直接放棄', () => {
    expect(() => scrollIntoContainer(null, null, 0)).not.toThrow()
  })
})

describe('useFocusRequest', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('selectTask 之後收到帶 taskId / src 的請求', async () => {
    const got: FocusRequest[] = []
    const Host = defineComponent({
      setup() {
        useFocusRequest((req) => void got.push(req))
        return () => h('div')
      },
    })
    wrapper = mount(Host)

    const selection = useSelectionStore()
    selection.selectTask('t3', 'card')
    await nextTick()
    await nextTick()

    expect(got).toEqual([{ taskId: 't3', src: 'card' }])
    wrapper.unmount()
  })
})
