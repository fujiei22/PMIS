import { describe, expect, it } from 'vitest'
import { WEEK_LABELS, monthGrid } from '@/lib/calendar'
import { dayIndex } from '@/lib/date'

describe('monthGrid', () => {
  it('固定 42 格、從該月 1 號往前補到週日', () => {
    const cells = monthGrid('2026-09', dayIndex('2026-09-18'))
    expect(cells).toHaveLength(42)
    // 2026-09-01 是週二 → 往前補到 2026-08-30（週日）
    expect(cells[0]!.iso).toBe('2026-08-30')
    expect(cells[0]!.label).toBe(30)
    expect(cells[0]!.inMonth).toBe(false)
    expect(cells[41]!.iso).toBe('2026-10-10')
    // 連續的日索引
    expect(cells.every((c, i) => c.idx === cells[0]!.idx + i)).toBe(true)
  })

  it('inMonth 只對當月為真，isToday 對上 todayIdx', () => {
    const today = dayIndex('2026-09-18')
    const cells = monthGrid('2026-09', today)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30)
    const first = cells.find((c) => c.inMonth)!
    expect(first.iso).toBe('2026-09-01')
    expect(first.label).toBe(1)
    expect(cells.filter((c) => c.isToday).map((c) => c.iso)).toEqual(['2026-09-18'])
  })

  it('todayIdx 不在這個月時沒有任何 isToday', () => {
    const cells = monthGrid('2026-01', dayIndex('2026-09-18'))
    expect(cells.some((c) => c.isToday)).toBe(false)
    expect(cells).toHaveLength(42)
    // 2026-01-01 是週四 → 從 2025-12-28（週日）起
    expect(cells[0]!.iso).toBe('2025-12-28')
  })

  it('1 號剛好是週日時不往前補', () => {
    const cells = monthGrid('2026-03', 0)
    expect(cells[0]!.iso).toBe('2026-03-01')
    expect(cells[0]!.inMonth).toBe(true)
  })

  it('WEEK_LABELS 是週日起的七個字', () => {
    expect(WEEK_LABELS).toEqual(['日', '一', '二', '三', '四', '五', '六'])
  })
})
