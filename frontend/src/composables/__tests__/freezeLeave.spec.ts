import { describe, expect, it } from 'vitest'
import { freezeLeave } from '@/composables/freezeLeave'

/**
 * TransitionGroup 的離場元素要停在原位淡出：
 * 只設 absolute 會跳到容器內容區起點，所以要連同當下的位置與尺寸一起寫死。
 */
describe('freezeLeave', () => {
  it('把離場元素釘在當下的位置與尺寸', () => {
    const el = document.createElement('div')
    Object.defineProperties(el, {
      offsetTop: { value: 40 },
      offsetLeft: { value: 12 },
      offsetWidth: { value: 300 },
      offsetHeight: { value: 88 },
    })
    freezeLeave(el)
    expect(el.style.position).toBe('absolute')
    expect([el.style.top, el.style.left, el.style.width, el.style.height]).toEqual([
      '40px',
      '12px',
      '300px',
      '88px',
    ])
  })
})
