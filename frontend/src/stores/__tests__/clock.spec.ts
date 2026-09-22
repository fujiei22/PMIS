import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayIndex } from '@/lib/date'
import { useClockStore } from '@/stores/clock'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('clockStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('todayIdx / todayIso 隨 now 改變', () => {
    const clock = useClockStore()
    clock.now = NOW
    expect(clock.todayIdx).toBe(dayIndex('2026-09-18'))
    expect(clock.todayIso).toBe('2026-09-18')

    clock.now = Date.parse('2026-10-01T10:00:00Z')
    expect(clock.todayIdx).toBe(dayIndex('2026-10-01'))
    expect(clock.todayIso).toBe('2026-10-01')
  })

  it('start 每 60 秒前進一次，stop 之後不再前進', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const clock = useClockStore()
    clock.start()
    expect(clock.now).toBe(NOW)

    // advanceTimersByTime 同時推進假的系統時間，tick 讀到的就是 NOW + 60s
    vi.advanceTimersByTime(60_000)
    expect(clock.now).toBe(NOW + 60_000)

    clock.stop()
    vi.advanceTimersByTime(120_000)
    expect(clock.now).toBe(NOW + 60_000)
  })

  it('重複 start 不會疊加計時器', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const clock = useClockStore()
    clock.start()
    clock.start()
    vi.advanceTimersByTime(60_000)
    expect(clock.now).toBe(NOW + 60_000)
    clock.stop()
  })

  // R3：ui 的 now / todayIdx / todayIso 轉接欄位已經拿掉（契約 C / E）
  it('ui 不再轉接時鐘欄位', () => {
    const ui = useUiStore() as unknown as Record<string, unknown>
    expect(ui.now).toBeUndefined()
    expect(ui.todayIdx).toBeUndefined()
    expect(ui.todayIso).toBeUndefined()
  })
})
