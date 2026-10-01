import { describe, expect, it } from 'vitest'
import { currentTranslate } from '@/lib/transform'

describe('currentTranslate', () => {
  it('讀 matrix 的位移；沒有 transform 回 0', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(currentTranslate(el)).toEqual({ x: 0, y: 0 })
    el.style.transform = 'matrix(1, 0, 0, 1, -30, 5)'
    expect(currentTranslate(el)).toEqual({ x: -30, y: 5 })
    el.remove()
  })
})
