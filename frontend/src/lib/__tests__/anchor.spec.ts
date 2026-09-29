import { describe, expect, it } from 'vitest'
import { anchorCalendar, anchorOptionMenu, anchorRowMenu, ROW_MENU_W } from '@/lib/anchor'

const VP = { width: 1440, height: 900 }

describe('anchorOptionMenu', () => {
  it('下方空間夠就開在觸發元素正下方', () => {
    expect(anchorOptionMenu({ left: 300, top: 100, bottom: 120 }, 4, VP)).toEqual({
      left: 300,
      top: 125,
    })
  })

  it('下方空間不夠就往上翻，高度依列數估', () => {
    // 4 列 → 4 * 27 + 12 = 120；900 - 860 = 40 < 130 → 往上開
    expect(anchorOptionMenu({ left: 300, top: 840, bottom: 860 }, 4, VP)).toEqual({
      left: 300,
      top: 840 - 120 - 5,
    })
  })

  it('列數超過 9 只算 9 列', () => {
    const many = anchorOptionMenu({ left: 0, top: 840, bottom: 860 }, 30, VP)
    const nine = anchorOptionMenu({ left: 0, top: 840, bottom: 860 }, 9, VP)
    expect(many.top).toBe(nine.top)
  })

  it('靠右時往左收，靠左時不小於 8', () => {
    expect(anchorOptionMenu({ left: 1400, top: 10, bottom: 30 }, 3, VP).left).toBe(1440 - 240)
    expect(anchorOptionMenu({ left: 0, top: 10, bottom: 30 }, 3, { width: 100, height: 900 }).left).toBe(8)
  })
})

describe('anchorRowMenu', () => {
  it('右緣對齊「⋮」、開在正下方', () => {
    expect(anchorRowMenu({ left: 340, right: 364, top: 100, bottom: 124 }, VP)).toEqual({
      left: 364 - ROW_MENU_W,
      top: 128,
    })
  })

  it('下方放不下就往上翻', () => {
    // 900 - 860 = 40 < 150 + 10 → 往上：840 - 150 - 4
    expect(anchorRowMenu({ left: 340, right: 364, top: 840, bottom: 860 }, VP).top).toBe(686)
  })

  it('左右都不超出視窗', () => {
    expect(anchorRowMenu({ left: 10, right: 34, top: 10, bottom: 30 }, VP).left).toBe(8)
    expect(anchorRowMenu({ left: 1500, right: 1524, top: 10, bottom: 30 }, VP).left).toBe(1440 - ROW_MENU_W - 8)
  })
})

describe('anchorCalendar', () => {
  it('任務日曆下方要 340px 才往下開', () => {
    expect(anchorCalendar({ left: 200, top: 100, bottom: 130 }, VP, 'task')).toEqual({
      left: 200,
      top: 136,
    })
    expect(anchorCalendar({ left: 200, top: 600, bottom: 630 }, VP, 'task')).toEqual({
      left: 200,
      top: 600 - 336,
    })
  })

  it('Issue 日曆的門檻與上翻位移比任務日曆小', () => {
    expect(anchorCalendar({ left: 200, top: 600, bottom: 630 }, VP, 'issue')).toEqual({
      left: 200,
      top: 600 - 330,
    })
  })

  it('左右都夾在視窗內', () => {
    expect(anchorCalendar({ left: 1430, top: 10, bottom: 40 }, VP, 'issue').left).toBe(1440 - 266)
    expect(anchorCalendar({ left: 5, top: 800, bottom: 880 }, VP, 'task').top).toBe(800 - 336)
    expect(anchorCalendar({ left: 5, top: 100, bottom: 880 }, VP, 'task').top).toBe(8)
  })
})
