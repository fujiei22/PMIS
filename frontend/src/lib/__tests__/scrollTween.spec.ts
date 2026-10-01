import { describe, expect, it } from 'vitest'
import { easeOutQuart, scrollTweenMs } from '@/lib/scrollTween'

describe('scrollTween', () => {
  it('時長依距離、夾在 460–1150ms（legacy :2653）', () => {
    expect(scrollTweenMs(0)).toBe(460)
    expect(scrollTweenMs(500)).toBe(540)
    expect(scrollTweenMs(-500)).toBe(540)
    expect(scrollTweenMs(9999)).toBe(1150)
  })

  it('ease-out quart', () => {
    expect(easeOutQuart(0)).toBe(0)
    expect(easeOutQuart(1)).toBe(1)
    expect(easeOutQuart(0.5)).toBeCloseTo(0.9375)
  })
})
