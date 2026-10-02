import { describe, expect, it } from 'vitest'
import { devOffset } from '@/lib/devClock'

/**
 * dev 的今天：預設 2026-09-18；?today= 可改；格式錯或日期不存在用預設；
 * 保留一天裡的時刻（今日線照常走）。
 * 只在 mock 的 dev server 生效；測試直接測純函式 devOffset，
 * 真實時間用本地 2026-10-03 14:30，跟目標日不同月，才看得出位移有沒有算對。
 */
describe('devOffset', () => {
  const real = new Date(2026, 9, 3, 14, 30).getTime() // 本地 2026-10-03 14:30
  const at = (search: string) => new Date(real + devOffset(search, real))

  it('預設把今天換成 2026-09-18，時刻不變', () => {
    const d = at('')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 8, 18, 14, 30,
    ])
  })

  it('?today=2026-10-05', () => {
    const d = at('?today=2026-10-05')
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([9, 5, 14, 30])
  })

  it('格式錯用預設', () => {
    expect(at('?today=10/05').getDate()).toBe(18)
  })

  // 格式對但日期不存在：new Date 會默默進位到 03-02，要擋下來改用預設
  it('日期不存在用預設', () => {
    const d = at('?today=2026-02-30')
    expect([d.getMonth(), d.getDate()]).toEqual([8, 18])
  })

  // 真實今天剛好是目標日（e2e 的 page.clock 固定在 09-18）時位移必須是 0，兩邊才一致
  it('真實今天就是目標日時位移為 0', () => {
    expect(devOffset('', new Date(2026, 8, 18, 10, 0).getTime())).toBe(0)
  })
})
