import { describe, expect, it, vi } from 'vitest'
import { LATE_GLYPHS, preloadLateGlyphs } from '@/lib/fontPreload'

/** J2：啟動時預載晚出現的符號所在的字型子集（三種字重），不等完成、失敗不拋。 */
describe('preloadLateGlyphs', () => {
  it('三種字重各載一次 LATE_GLYPHS（含 ▶）', () => {
    const load = vi.fn(() => Promise.resolve([] as FontFace[]))
    preloadLateGlyphs({ load } as unknown as FontFaceSet)
    expect(LATE_GLYPHS).toContain('▶')
    expect(load.mock.calls).toEqual([
      ['400 16px "Noto Sans TC"', LATE_GLYPHS],
      ['500 16px "Noto Sans TC"', LATE_GLYPHS],
      ['700 16px "Noto Sans TC"', LATE_GLYPHS],
    ])
  })

  it('載入失敗（離線）不拋錯', async () => {
    const load = vi.fn(() => Promise.reject(new Error('offline')))
    expect(() => preloadLateGlyphs({ load } as unknown as FontFaceSet)).not.toThrow()
    await Promise.resolve()
  })

  it('沒有 FontFaceSet 的環境：什麼都不做', () => {
    expect(() => preloadLateGlyphs(undefined)).not.toThrow()
    expect(() => preloadLateGlyphs({} as FontFaceSet)).not.toThrow()
  })
})
