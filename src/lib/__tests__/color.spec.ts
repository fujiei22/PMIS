import { describe, expect, it } from 'vitest'
import { initialOf, rgba } from '@/lib/color'
import type { Member } from '@/types/models'

const m = (name: string): Member => ({ id: 'm1', name, role: '', color: '#2563eb' })

describe('color', () => {
  it('rgba 支援 6 碼與 3 碼色碼', () => {
    expect(rgba('#2563eb', 0.1)).toBe('rgba(37,99,235,0.1)')
    expect(rgba('#fff', 1)).toBe('rgba(255,255,255,1)')
    expect(rgba('2563eb', 0.5)).toBe('rgba(37,99,235,0.5)')
  })

  it('rgba 空值退回 accent 藍', () => {
    expect(rgba('', 0.2)).toBe('rgba(37,99,235,0.2)')
  })

  it('initialOf 優先取名字裡的數字', () => {
    expect(initialOf(m('成員12'))).toBe('12')
    expect(initialOf(m('王小明'))).toBe('王')
    expect(initialOf(undefined)).toBe('?')
  })
})
