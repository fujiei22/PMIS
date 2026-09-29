import { describe, expect, it } from 'vitest'
import { isImeComposing } from '@/lib/keyboard'

describe('keyboard', () => {
  it('isImeComposing：選字中（isComposing）或 Safari 確定選字那一下（keyCode 229）都算', () => {
    expect(isImeComposing(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(true)
    expect(isImeComposing(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }))).toBe(true)
  })

  it('isImeComposing：一般的 Enter 不算', () => {
    expect(isImeComposing(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }))).toBe(false)
  })
})
