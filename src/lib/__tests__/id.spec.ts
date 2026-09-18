import { describe, it, expect } from 'vitest'
import { nextId } from '@/lib/id'

describe('nextId', () => {
  it('nextId 遞增且帶前綴', () => {
    expect(nextId('t')).toBe('t101')
    expect(nextId('g')).toBe('g102')
    expect(nextId('i')).toBe('i103')
    expect(nextId('d')).toBe('d104')
  })

  it('留言 id 用時間戳，避免與資料序號撞號', () => {
    const id = nextId('c')
    expect(id).toMatch(/^c\d{13}$/)
  })
})
