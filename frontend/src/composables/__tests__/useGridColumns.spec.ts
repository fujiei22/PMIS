import { describe, expect, it } from 'vitest'
import { countGridColumns } from '@/composables/useGridColumns'

/**
 * 從 computed style 的 grid-template-columns 數欄數。
 * 瀏覽器回傳的是解析後的 px 清單（auto-fill 已展開）；jsdom 或非 grid 元素會是空字串或 none，當 1 欄。
 */
describe('countGridColumns', () => {
  it('數解析後的 px 清單', () => {
    expect(countGridColumns('335.3px 335.3px 335.3px')).toBe(3)
    expect(countGridColumns('540px')).toBe(1)
  })

  it('空字串、none 當 1 欄', () => {
    expect(countGridColumns('')).toBe(1)
    expect(countGridColumns('none')).toBe(1)
  })
})
