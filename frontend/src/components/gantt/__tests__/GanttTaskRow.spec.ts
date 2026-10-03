import { mount } from '@vue/test-utils'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import GanttTaskRow from '@/components/gantt/GanttTaskRow.vue'
import { NARROW_QUERY } from '@/composables/useMediaQuery'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/**
 * 甘特左欄任務列的工期：顯示有效工期（工作天，規則見 docs/reference/scheduling.md〈有效工期〉），
 * 不是起訖之間的日曆天。
 *
 * 整個檔案都當窄版（平板直向）：useMediaQuery 的快取是模組層級的，要在第一次掛元件前換好 matchMedia。
 * 窄版而且左欄沒展開（ui.ganttLeftDates=false）時膠囊只寫工期；展開後才是「起訖＋工期格」。
 */
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query === NARROW_QUERY,
  media: query,
  addEventListener: () => {},
}))

afterAll(() => {
  vi.unstubAllGlobals()
})

/** 掛某個任務的列；props 取 store 推算後的任務。 */
function mountRow(id: string) {
  return mount(GanttTaskRow, { props: { task: useTaskStore().taskById(id)! } })
}

describe('GanttTaskRow 工期', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('窄版的膠囊寫「N 工作天」：t3 逾期延長後是 9 工作天', () => {
    const w = mountRow('t3')
    expect(w.find('.date').classes()).toContain('slim')
    expect(w.find('.date-text').text()).toBe('9 工作天')
  })

  it('已完成的任務算實際工作天：t2（09-02～09-08，跨一個週末）是 5 工作天，不是 7 天', () => {
    expect(mountRow('t2').find('.date-text').text()).toBe('5 工作天')
  })

  it('展開後的工期格：數字是有效工期，title 是「工期（工作天）」', () => {
    useUiStore().ganttLeftDates = true
    const w = mountRow('t3')
    const days = w.find('.date-days')
    expect(days.attributes('title')).toBe('工期（工作天）')
    expect(days.find('.days-num').text()).toBe('9')
  })
})
