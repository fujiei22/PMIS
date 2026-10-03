import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSample } from '@/__tests__/loadSample'
import GanttPanel from '@/components/gantt/GanttPanel.vue'
import { CALENDAR_NOTICE } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'
import { useWorkCalendarStore } from '@/stores/workCalendar'
import type { ProjectData, WorkCalendar } from '@/types/models'

/**
 * 甘特圖的假日與日曆提示（規則見 docs/reference/scheduling.md〈工作天〉）：
 * 非工作天（週末、放假日）的日底色與尺規格都是 `.off`，尺規格的 title 寫假日名稱；補班日是工作天，不上底色。
 * 標題列在日曆載入失敗、或任務期間碰到還沒公布假日的年份時寫一行提示。
 */

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountPanel(): VueWrapper {
  wrapper = mount(GanttPanel, { attachTo: document.body })
  return wrapper
}

/** 某一天的尺規格與日底色（兩者都帶 `data-idx`＝日索引）。 */
function dayCells(w: VueWrapper, iso: string) {
  const idx = String(dayIndex(iso))
  return {
    ruler: w.findAll('.days .day').find((c) => c.attributes('data-idx') === idx)!,
    bg: w.findAll('.day-bg').find((c) => c.attributes('data-idx') === idx)!,
  }
}

describe('GanttPanel 的假日標示', () => {
  beforeEach(async () => {
    await loadSample()
  })

  it('09-25（中秋，週五）與 09-26（週六）都是 .off；中秋那格的 title 是假日名稱', () => {
    const w = mountPanel()
    const moon = dayCells(w, '2026-09-25')
    expect(moon.ruler.classes()).toContain('off')
    expect(moon.bg.classes()).toContain('off')
    expect(moon.ruler.attributes('title')).toBe('中秋節')
    const sat = dayCells(w, '2026-09-26')
    expect(sat.ruler.classes()).toContain('off')
    expect(sat.bg.classes()).toContain('off')
    // 平常的工作天沒有底色
    expect(dayCells(w, '2026-09-24').ruler.classes()).not.toContain('off')
  })

  it('補班日（自備日曆的 10/17 週六）是工作天，不上底色', () => {
    const cal: WorkCalendar = {
      ...structuredClone(sampleCalendar),
      days: [
        ...structuredClone(sampleCalendar.days),
        { date: '2026-10-17', isWorkday: true, name: '補班', source: 'override' },
      ],
    }
    useWorkCalendarStore().setAll(cal)
    const w = mountPanel()
    expect(dayCells(w, '2026-10-17').ruler.classes()).not.toContain('off')
    expect(dayCells(w, '2026-10-17').bg.classes()).not.toContain('off')
    expect(dayCells(w, '2026-10-18').ruler.classes()).toContain('off')
  })
})

describe('GanttPanel 的日曆提示', () => {
  it('範例（日曆涵蓋任務期間）沒有提示', async () => {
    await loadSample()
    expect(mountPanel().find('[data-testid="cal-notice"]').text()).toBe('')
  })

  it('日曆還沒載入（idle）時沒有提示', async () => {
    await loadSample()
    useWorkCalendarStore().status = 'idle'
    expect(mountPanel().find('[data-testid="cal-notice"]').text()).toBe('')
  })

  it('日曆載入失敗：提示只排除週末、重新整理可重試', async () => {
    await loadSample()
    useWorkCalendarStore().status = 'error'
    const notice = mountPanel().find('[data-testid="cal-notice"]')
    expect(notice.text()).toBe(CALENDAR_NOTICE.error)
    expect(notice.attributes('title')).toBe(CALENDAR_NOTICE.error)
  })

  it('任務期間跨到還沒公布假日的年份：連續年份合併成「2027–2028」', async () => {
    // t30（未開始的根任務）挪到 2028 年；日曆只涵蓋 2026
    const data: ProjectData = structuredClone(sampleProject)
    data.tasks.find((t) => t.id === 't30')!.start = '2028-03-01'
    await loadSample({ data })
    useWorkCalendarStore().setAll({ ...structuredClone(sampleCalendar), coveredYears: [2026] })
    const notice = mountPanel().find('[data-testid="cal-notice"]')
    expect(notice.text()).toBe(CALENDAR_NOTICE.uncovered('2027–2028'))
  })
})
