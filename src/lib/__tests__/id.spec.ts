import { beforeEach, describe, it, expect } from 'vitest'
import { nextId, resetIdSeq } from '@/lib/id'

describe('nextId', () => {
  beforeEach(() => {
    resetIdSeq()
  })

  it('nextId 遞增且帶前綴', () => {
    expect(nextId('t')).toBe('t101')
    expect(nextId('g')).toBe('g102')
    expect(nextId('i')).toBe('i103')
    expect(nextId('d')).toBe('d104')
  })

  // review M5：原本留言用 'c' + Date.now()，固定時鐘下連兩則會同 id。
  it('留言 id 也走流水號，同一毫秒連發兩則不會撞號', () => {
    const a = nextId('c')
    const b = nextId('c')
    expect(a).toBe('c101')
    expect(b).toBe('c102')
    expect(a).not.toBe(b)
  })

  it('留言序號與其他資料共用同一條流水號', () => {
    expect(nextId('c')).toBe('c101')
    expect(nextId('t')).toBe('t102')
    expect(nextId('c')).toBe('c103')
  })
})
