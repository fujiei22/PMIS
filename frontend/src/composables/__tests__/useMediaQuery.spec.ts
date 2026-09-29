import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from '@/composables/useMediaQuery'

/**
 * 全站共用的 media query ref：同一個 query 只向瀏覽器註冊一次監聽（甘特每一列、每一條都會用到），
 * 裝置或視窗改變時值跟著變；沒有 matchMedia 的環境（jsdom）一律 false。
 * 快取是模組層級的，所以每個測試用不同的 query 字串。
 */

type Listener = (e: { matches: boolean }) => void

/** 假的 matchMedia：記下每個 query 的監聽器，讓測試手動觸發 change。 */
function stubMatchMedia(initial: boolean) {
  const listeners = new Map<string, Listener[]>()
  const calls: string[] = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      calls.push(query)
      return {
        matches: initial,
        addEventListener: (_: string, fn: Listener) => listeners.set(query, [...(listeners.get(query) ?? []), fn]),
      }
    }),
  )
  return {
    calls,
    fire(query: string, matches: boolean) {
      for (const fn of listeners.get(query) ?? []) fn({ matches })
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('useMediaQuery', () => {
  it('同一個 query 共用一個 ref、只註冊一次；change 時跟著變', () => {
    const mm = stubMatchMedia(false)
    const a = useMediaQuery('(test-a)')
    const b = useMediaQuery('(test-a)')
    expect(mm.calls.filter((q) => q === '(test-a)')).toHaveLength(1)
    expect(a.value).toBe(false)
    mm.fire('(test-a)', true)
    expect(a.value).toBe(true)
    expect(b.value).toBe(true)
  })

  it('初始值取 matchMedia 當下的結果', () => {
    stubMatchMedia(true)
    expect(useMediaQuery('(test-b)').value).toBe(true)
  })

  it('沒有 matchMedia 時是 false', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(useMediaQuery('(test-c)').value).toBe(false)
  })
})
