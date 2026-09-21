import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDelayedUnmount } from '@/composables/useDelayedUnmount'

/** 掛一個最小宿主，把 open 的開關與回傳的 mounted 都撈出來。 */
function mountHost(delayMs?: number): {
  open: Ref<boolean>
  mounted: Ref<boolean>
  wrapper: VueWrapper
} {
  const open = ref(true)
  let mounted!: Ref<boolean>
  const Host = defineComponent({
    setup() {
      mounted = useDelayedUnmount(open, delayMs)
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { open, mounted, wrapper }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDelayedUnmount', () => {
  it('關閉後撐滿預設 320ms 才卸載', async () => {
    const host = mountHost()
    expect(host.mounted.value).toBe(true)

    host.open.value = false
    await nextTick()
    expect(host.mounted.value).toBe(true)

    vi.advanceTimersByTime(319)
    expect(host.mounted.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(host.mounted.value).toBe(false)
  })

  it('倒數途中再打開就取消卸載', async () => {
    const host = mountHost()
    host.open.value = false
    await nextTick()
    vi.advanceTimersByTime(200)

    host.open.value = true
    await nextTick()
    expect(host.mounted.value).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(host.mounted.value).toBe(true)
  })

  it('自訂延遲時間', async () => {
    const host = mountHost(50)
    host.open.value = false
    await nextTick()
    vi.advanceTimersByTime(50)
    expect(host.mounted.value).toBe(false)
  })

  it('卸載宿主會清掉還在跑的計時器', async () => {
    const host = mountHost()
    host.open.value = false
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    host.wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
