import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyUnauthorized, onUnauthorized } from '@/api/authEvents'

/** 401 的通知：api 層發、畫面層收；取消註冊後不再收到，一個 handler 拋錯不連累別人。 */
describe('authEvents', () => {
  const offs: (() => void)[] = []
  afterEach(() => {
    for (const off of offs.splice(0)) off()
    vi.restoreAllMocks()
  })

  it('通知時每個 handler 都收到；取消註冊後不再收到', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onUnauthorized(a)
    offs.push(offA, onUnauthorized(b))
    notifyUnauthorized()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    notifyUnauthorized()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('一個 handler 拋錯只進 console，其他照收、呼叫端不跟著拋', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    offs.push(
      onUnauthorized(() => {
        throw new Error('boom')
      }),
      onUnauthorized(after),
    )
    expect(() => notifyUnauthorized()).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalledWith('[auth] 401 的處理拋錯', expect.any(Error))
  })
})
