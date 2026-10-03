import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { loadSample } from '@/__tests__/loadSample'
import GanttPanel from '@/components/gantt/GanttPanel.vue'
import { BASELINE_LOCK_TEXT, CALENDAR_NOTICE } from '@/constants/dashboard'
import { dayIndex } from '@/lib/date'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
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

// 基準鎖按鈕：緊貼任務數、狀態一眼看得出來（已鎖定藍、未鎖定琥珀），點了開確認框（見 ui.askBaselineLock）
describe('GanttPanel 的基準鎖按鈕', () => {
  beforeEach(async () => {
    await loadSample()
  })

  const lockBtn = (w: VueWrapper) => w.find('[data-testid="baseline-lock"]')

  it('上鎖中：寫「基準已鎖定」，title 帶鎖定日，aria-pressed=true；點了開解鎖確認', async () => {
    const btn = lockBtn(mountPanel())
    expect(btn.attributes('aria-label')).toBe(BASELINE_LOCK_TEXT.locked)
    expect(btn.text()).toContain(BASELINE_LOCK_TEXT.locked)
    expect(btn.attributes('title')).toBe(BASELINE_LOCK_TEXT.lockedTitle('2026/08/24'))
    expect(btn.attributes('aria-pressed')).toBe('true')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(useUiStore().confirm).toEqual({ kind: 'baselineUnlock', step: 1 })
  })

  it('排在「共 N 個任務」正後面', () => {
    const count = mountPanel().find('[data-testid="task-count"]')
    expect((count.element.nextElementSibling as HTMLElement).dataset.testid).toBe('baseline-lock')
  })

  it('狀態用不同的樣式：上鎖 locked、解鎖 unlocked', async () => {
    const btn = lockBtn(mountPanel())
    expect(btn.classes()).toContain('locked')
    expect(btn.classes()).not.toContain('unlocked')
    const project = useProjectStore()
    project.setMeta({ ...project.meta, baselineLockedOn: '' })
    await nextTick()
    expect(btn.classes()).toContain('unlocked')
    expect(btn.classes()).not.toContain('locked')
  })

  it('解鎖：寫「基準未鎖定」，aria-pressed=false', () => {
    const project = useProjectStore()
    project.setMeta({ ...project.meta, baselineLockedOn: '' })
    const btn = lockBtn(mountPanel())
    expect(btn.text()).toContain(BASELINE_LOCK_TEXT.unlocked)
    expect(btn.attributes('title')).toBe(BASELINE_LOCK_TEXT.unlockedTitle)
    expect(btn.attributes('aria-pressed')).toBe('false')
  })

  it('唯讀：照樣顯示狀態，但停用', () => {
    const project = useProjectStore()
    project.setAll(project.meta, false)
    const btn = lockBtn(mountPanel())
    expect(btn.text()).toContain(BASELINE_LOCK_TEXT.locked)
    expect(btn.attributes('disabled')).toBeDefined()
    // 唯讀照樣上狀態色（只是不能點），不轉灰
    expect(btn.classes()).toContain('locked')
    expect(btn.classes()).not.toContain('blocked')
  })

  it('日曆載入失敗而且解鎖中：停用，title 說明暫時不能上鎖', () => {
    const project = useProjectStore()
    project.setMeta({ ...project.meta, baselineLockedOn: '' })
    useWorkCalendarStore().status = 'error'
    const btn = lockBtn(mountPanel())
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toBe(BASELINE_LOCK_TEXT.calendarError)
    // 能編輯卻不能上鎖：轉灰（blocked）
    expect(btn.classes()).toContain('blocked')
  })
})
