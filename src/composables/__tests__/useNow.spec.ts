import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from '@/composables/useNow'
import { useClockStore } from '@/stores/clock'

/** 掛一個最小宿主啟動時鐘。 */
function mountHost(intervalMs?: number): VueWrapper {
  const Host = defineComponent({
    setup() {
      useNow(intervalMs)
      return () => h('div')
    },
  })
  return mount(Host)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('掛載時先對一次時，之後每 60 秒 tick 一次', () => {
    vi.setSystemTime(new Date('2026-09-21T09:00:00'))
    const clock = useClockStore()
    const wrapper = mountHost()

    expect(clock.now).toBe(new Date('2026-09-21T09:00:00').getTime())

    // 59 秒還沒到門檻
    vi.advanceTimersByTime(59_000)
    expect(clock.now).toBe(new Date('2026-09-21T09:00:00').getTime())

    vi.advanceTimersByTime(1_000)
    expect(clock.now).toBe(new Date('2026-09-21T09:01:00').getTime())

    wrapper.unmount()
  })

  it('跨日後 todayIdx / todayIso 跟著走', () => {
    vi.setSystemTime(new Date('2026-09-21T23:59:00'))
    const clock = useClockStore()
    const wrapper = mountHost(1_000)
    const before = clock.todayIdx

    vi.advanceTimersByTime(60_000)

    expect(clock.todayIdx).toBe(before + 1)
    expect(clock.todayIso).toBe('2026-09-22')
    wrapper.unmount()
  })

  it('卸載後停止 tick', () => {
    vi.setSystemTime(new Date('2026-09-21T09:00:00'))
    const clock = useClockStore()
    mountHost().unmount()

    vi.advanceTimersByTime(600_000)
    expect(clock.now).toBe(new Date('2026-09-21T09:00:00').getTime())
  })
})
