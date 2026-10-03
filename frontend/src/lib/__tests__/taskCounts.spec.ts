import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { scheduleWithPlan } from '@/lib/schedule'
import { countTasks, leafTasksOf } from '@/lib/taskCounts'
import { createWorkdays } from '@/lib/workdays'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'

/**
 * 任務計數：Dashboard 摘要卡與總覽共用的唯一定義（規則見 docs/reference/scheduling.md〈已延遲與計畫進度〉）。
 * 範例資料的數字同 scheduling.md〈檢查點〉：09-18 計畫應完成 5、延遲 1（t13）；09-22 應完成 6、延遲 2（t8、t13）。
 */
const WD = createWorkdays(sampleCalendar)
const at = (day: string) => {
  const today = dayIndex(day)
  return countTasks(scheduleWithPlan(sampleProject.tasks, sampleProject.deps, WD, today), today)
}

describe('countTasks', () => {
  it('09-18：30 筆，各狀態 18／7／1／4，計畫應完成 5、延遲 1', () => {
    expect(at('2026-09-18')).toEqual({
      total: 30,
      byStatus: { todo: 18, doing: 7, paused: 1, done: 4 },
      planned: 5,
      late: 1,
    })
  })

  it('09-22：計畫應完成 6、延遲 2', () => {
    const c = at('2026-09-22')
    expect([c.planned, c.late]).toEqual([6, 2])
  })

  it('沒有任務：全部是 0', () => {
    expect(countTasks([], dayIndex('2026-09-18'))).toEqual({
      total: 0,
      byStatus: { todo: 0, doing: 0, paused: 0, done: 0 },
      planned: 0,
      late: 0,
    })
  })
})

describe('leafTasksOf', () => {
  it('目前只有兩層：回同一個陣列（不複製，store 的 computed 不會因此換新）', () => {
    const tasks = sampleProject.tasks
    expect(leafTasksOf(tasks)).toBe(tasks)
  })
})
