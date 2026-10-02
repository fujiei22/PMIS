import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { dayIndex } from '@/lib/date'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'
import { useWorkCalendarStore } from '@/stores/workCalendar'

/**
 * 工作日曆的載入（規則見 docs/reference/scheduling.md〈工作天〉）：
 * - 成功：status ready，workdays 認得假日（2026-09-25 中秋節）。
 * - 失敗：不 reject（不擋 Dashboard），status error，workdays 退回只看週末。
 * - 已有資料時重載失敗：保留舊資料、維持 ready（背景重載的暫時性錯誤不該讓假日消失）。
 * - 401：交給登入流程（api 層已通知），不設 error，導回登入頁前不閃「載入失敗」。
 * - setAll：同步設好資料（單元測試共用前置用）。
 * - uncoveredYears：只有 ready 時才判斷，還沒載入不誤報「未公布」。
 */
const mockApi = maybeMockApi!

describe('workCalendarStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('載入成功：認得假日', async () => {
    const cal = useWorkCalendarStore()
    await cal.load()
    expect(cal.status).toBe('ready')
    expect(cal.workdays.isWorkday(dayIndex('2026-09-25'))).toBe(false)
    expect(cal.workdays.nameOf(dayIndex('2026-09-25'))).toBe('中秋節')
  })

  it('載入失敗：不 reject、退回只看週末', async () => {
    mockApi.failNext('getCalendar')
    const cal = useWorkCalendarStore()
    await expect(cal.load()).resolves.toBeUndefined()
    expect(cal.status).toBe('error')
    expect(cal.workdays.isWorkday(dayIndex('2026-09-25'))).toBe(true)
  })

  it('已有資料時重載失敗：保留舊資料', async () => {
    const cal = useWorkCalendarStore()
    await cal.load()
    mockApi.failNext('getCalendar')
    await cal.load()
    expect(cal.status).toBe('ready')
    expect(cal.workdays.isWorkday(dayIndex('2026-09-25'))).toBe(false)
  })

  it('401：不設 error（登入流程會導回登入頁）', async () => {
    mockApi.failNext('getCalendar', new ApiError('unauthorized', '沒有登入', 401))
    const cal = useWorkCalendarStore()
    await cal.load()
    expect(cal.status).not.toBe('error')
  })

  it('setAll：同步設好資料', () => {
    const cal = useWorkCalendarStore()
    cal.setAll(structuredClone(sampleCalendar))
    expect(cal.status).toBe('ready')
    expect(cal.workdays.nameOf(dayIndex('2026-10-10'))).toBe('國慶日')
  })

  it('uncoveredYears：只在 ready 時判斷，期間跨到 2028 時回 [2028]', async () => {
    const cal = useWorkCalendarStore()
    expect(cal.uncoveredYears(dayIndex('2027-12-01'), dayIndex('2028-01-10'))).toEqual([])
    await cal.load()
    expect(cal.uncoveredYears(dayIndex('2026-08-24'), dayIndex('2026-11-18'))).toEqual([])
    expect(cal.uncoveredYears(dayIndex('2027-12-01'), dayIndex('2028-01-10'))).toEqual([2028])
  })
})
