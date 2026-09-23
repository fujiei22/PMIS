import { describe, expect, it } from 'vitest'
import {
  alertOf,
  bumpOverviewSort, deriveProject, dueSoon, gapTone, groupByPm, matchProject, pct, pmOptions, sortRows, timelineRange,
  type ProjectRow,
} from '@/lib/portfolio'
import type { Member, ProjectSummary } from '@/types/models'

/** 建一筆最小專案；只覆寫測試關心的欄位。 */
function proj(over: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: 'x', name: 'X', pmId: 'm5', status: 'doing',
    startDate: '2026-08-24', dueDate: '2026-11-10',
    taskTotal: 35, taskDone: 4, taskPlanned: 12,
    taskCounts: { done: 4, doing: 11, paused: 3, todo: 17 },
    delayedTasks: 0, openIssues: { A: 0, B: 0, C: 0, D: 0 }, closedIssues: 0,
    memberIds: [], upcoming: [], ...over,
  }
}
const row = (over: Partial<ProjectSummary>, today = '2026-09-22'): ProjectRow => {
  const p = proj(over)
  return { p, d: deriveProject(p, today) }
}
const m = (id: string, name: string): Member => ({ id, name, role: '專案經理', color: '#000000' })

describe('pct', () => {
  it('四捨五入到整數；總數 0 回 0', () => {
    expect(pct(4, 35)).toBe(11)
    expect(pct(32, 52)).toBe(62)
    expect(pct(0, 0)).toBe(0)
  })
})

describe('deriveProject', () => {
  it('PMIS 設計稿數字：實際 11、理論 34、落後 23；天數頭尾都算：總 79、已過 29、剩 50', () => {
    const d = deriveProject(proj({ delayedTasks: 3 }), '2026-09-22')
    expect(d).toMatchObject({ actualPct: 11, plannedPct: 34, gap: 23, alert: 'late', badge: 'late',
      totalDays: 79, elapsedDays: 29, remainingDays: 50 })
    expect(d.timePct).toBe(37)
  })
  it('天數和 Dashboard「專案總時長」一樣頭尾都算：到期日當天還剩 1 天，隔天才是 0', () => {
    const p = proj({ startDate: '2026-09-01', dueDate: '2026-09-10' })
    expect(deriveProject(p, '2026-09-01')).toMatchObject({ totalDays: 10, elapsedDays: 0, remainingDays: 10 })
    expect(deriveProject(p, '2026-09-10')).toMatchObject({ elapsedDays: 9, remainingDays: 1 })
    expect(deriveProject(p, '2026-09-11')).toMatchObject({ elapsedDays: 10, remainingDays: 0 })
  })
  it('實際超前理論時落後值為 0，不是負數', () => {
    expect(deriveProject(proj({ taskDone: 20, taskPlanned: 10 }), '2026-09-22').gap).toBe(0)
  })
  it('未開始：已過 0、剩餘 = 總天數；已完成：已過 = 總天數、剩 0', () => {
    const todo = deriveProject(proj({ status: 'todo', startDate: '2026-10-12', dueDate: '2027-01-08' }), '2026-09-22')
    expect([todo.elapsedDays, todo.remainingDays]).toEqual([0, todo.totalDays])
    const done = deriveProject(proj({ status: 'done', startDate: '2026-06-15', dueDate: '2026-09-12' }), '2026-09-22')
    expect([done.elapsedDays, done.remainingDays, done.badge]).toEqual([done.totalDays, 0, 'done'])
  })
  it('未結 Issue 總數加總四個等級', () => {
    expect(deriveProject(proj({ openIssues: { A: 1, B: 2, C: 2, D: 0 } }), '2026-09-22').openIssueTotal).toBe(5)
  })
})

describe('alertOf', () => {
  it('落後 ≥15 或延遲任務 ≥3 → late', () => {
    expect(alertOf(proj({}), 15)).toBe('late')
    expect(alertOf(proj({ delayedTasks: 3 }), 0)).toBe('late')
  })
  it('有 A 級未結 Issue 或落後 5~14 → watch', () => {
    expect(alertOf(proj({ openIssues: { A: 1, B: 0, C: 0, D: 0 } }), 0)).toBe('watch')
    expect(alertOf(proj({}), 5)).toBe('watch')
    expect(alertOf(proj({}), 14)).toBe('watch')
  })
  it('其餘 none；已完成與未開始一律 none', () => {
    expect(alertOf(proj({}), 4)).toBe('none')
    expect(alertOf(proj({ status: 'done', delayedTasks: 9 }), 30)).toBe('none')
    expect(alertOf(proj({ status: 'todo' }), 30)).toBe('none')
  })
})

describe('matchProject', () => {
  const r = row({ pmId: 'm5', status: 'doing', delayedTasks: 3 })
  it('空條件＝全部通過', () => {
    expect(matchProject(r, { pmIds: [], statuses: [], alerts: [] })).toBe(true)
  })
  it('三組條件之間是 AND、組內是 OR', () => {
    expect(matchProject(r, { pmIds: ['m5', 'm8'], statuses: ['doing'], alerts: ['late'] })).toBe(true)
    expect(matchProject(r, { pmIds: ['m8'], statuses: [], alerts: [] })).toBe(false)
    expect(matchProject(r, { pmIds: [], statuses: ['todo'], alerts: [] })).toBe(false)
    expect(matchProject(r, { pmIds: [], statuses: [], alerts: ['none'] })).toBe(false)
  })
})

describe('sortRows', () => {
  const a = row({ id: 'a', taskDone: 4, taskPlanned: 12, dueDate: '2026-11-10' }) // gap 23
  const b = row({ id: 'b', taskDone: 4, taskPlanned: 4, dueDate: '2026-10-01' })  // gap 0
  const c = row({ id: 'c', taskDone: 4, taskPlanned: 4, dueDate: '2026-09-30' })  // gap 0
  it('第一鍵分不出高下才看第二鍵', () => {
    const out = sortRows([b, a, c], [{ k: 'gap', dir: 'desc' }, { k: 'due', dir: 'asc' }])
    expect(out.map((x) => x.p.id)).toEqual(['a', 'c', 'b'])
  })
  it('沒有排序鍵時維持原順序，且不改動輸入陣列', () => {
    const input = [b, a, c]
    expect(sortRows(input, []).map((x) => x.p.id)).toEqual(['b', 'a', 'c'])
    sortRows(input, [{ k: 'gap', dir: 'desc' }])
    expect(input.map((x) => x.p.id)).toEqual(['b', 'a', 'c'])
  })
  it('issues 依未結 Issue 總數；start 依開始日', () => {
    const i1 = row({ id: 'i1', openIssues: { A: 0, B: 1, C: 0, D: 0 }, startDate: '2026-09-01' })
    const i2 = row({ id: 'i2', openIssues: { A: 0, B: 3, C: 0, D: 0 }, startDate: '2026-08-01' })
    expect(sortRows([i1, i2], [{ k: 'issues', dir: 'desc' }]).map((x) => x.p.id)).toEqual(['i2', 'i1'])
    expect(sortRows([i1, i2], [{ k: 'start', dir: 'asc' }]).map((x) => x.p.id)).toEqual(['i2', 'i1'])
  })
})

describe('groupByPm', () => {
  const pms = [m('m5', '成員5'), m('m8', '成員8')]
  const byId = (id: string) => pms.find((x) => x.id === id)
  it('組的順序＝各 PM 第一個專案在已排序清單中的位置；組內保留順序', () => {
    const rows = [row({ id: 'p', pmId: 'm8' }), row({ id: 'q', pmId: 'm5' }), row({ id: 'r', pmId: 'm8' })]
    const { groups } = groupByPm(rows, byId)
    expect(groups.map((x) => x.pm.id)).toEqual(['m8', 'm5'])
    expect(groups[0]!.rows.map((x) => x.p.id)).toEqual(['p', 'r'])
  })
  it('alertCount 算 late + watch；查不到 PM 的專案進 orphans', () => {
    // proj() 預設 gap 23 已是 late，第二列把 taskPlanned 調成 4（gap 0）才是 none
    const rows = [row({ pmId: 'm5', delayedTasks: 3 }), row({ pmId: 'm5', taskPlanned: 4 }), row({ id: 'lost', pmId: 'ghost' })]
    const { groups, orphans } = groupByPm(rows, byId)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.alertCount).toBe(1)
    expect(orphans).toEqual(['lost'])
  })
})

describe('pmOptions', () => {
  it('每位 PM 的進行中 / 未開始數與是否有需注意專案', () => {
    const pms = [m('m5', '成員5'), m('m9', '成員9')]
    const rows = [
      row({ pmId: 'm5', status: 'doing', delayedTasks: 3 }),
      row({ pmId: 'm5', status: 'doing' }),
      row({ pmId: 'm9', status: 'done' }),
      row({ pmId: 'm9', status: 'todo' }),
    ]
    expect(pmOptions(rows, pms).map((o) => [o.pm.id, o.doing, o.todo, o.hasAlert, o.total])).toEqual([
      ['m5', 2, 0, true, 2],
      ['m9', 0, 1, false, 2],
    ])
  })
})

describe('gapTone', () => {
  it('≥15 behind、5~14 warn、其餘 flat', () => {
    expect([gapTone(23), gapTone(15), gapTone(14), gapTone(5), gapTone(4), gapTone(0)])
      .toEqual(['behind', 'behind', 'warn', 'warn', 'flat', 'flat'])
  })
})

describe('dueSoon', () => {
  it('距今 0~2 天或已逾期 → true；3 天以上 → false', () => {
    expect(dueSoon('2026-09-22', '2026-09-22')).toBe(true)
    expect(dueSoon('2026-09-24', '2026-09-22')).toBe(true)
    expect(dueSoon('2026-09-25', '2026-09-22')).toBe(false)
    expect(dueSoon('2026-09-20', '2026-09-22')).toBe(true)
  })
})

describe('timelineRange', () => {
  it('從最早開始日的月初到最晚到期日的月底；月份天數正確', () => {
    const r = timelineRange([proj({ startDate: '2026-06-15', dueDate: '2026-09-12' }),
      proj({ startDate: '2026-10-12', dueDate: '2027-01-20' })], '2026-09-22')
    expect(r.months.map((x) => x.iso)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
    expect(r.days).toBe(245)
    expect(r.dayList).toHaveLength(245)
    expect(r.dayList[0]).toMatchObject({ date: 1, weekday: 1, isMonday: true, isWeekend: false }) // 2026-06-01 是週一
  })
  it('今天在所有專案之外時，範圍延伸到今天所在月份', () => {
    const r = timelineRange([proj({ startDate: '2026-10-12', dueDate: '2026-11-20' })], '2026-09-22')
    expect(r.months.map((x) => x.iso)).toEqual(['2026-09', '2026-10', '2026-11'])
  })
  it('沒有專案時只有今天所在月份', () => {
    expect(timelineRange([], '2026-09-22').months.map((x) => x.iso)).toEqual(['2026-09'])
  })

  it('bumpOverviewSort：新鍵用總覽自己的預設方向（落後 / Issue 大到小、日期早到晚），再點翻方向', () => {
    expect(bumpOverviewSort([], 'issues')).toEqual([{ k: 'issues', dir: 'desc' }])
    expect(bumpOverviewSort([], 'start')).toEqual([{ k: 'start', dir: 'asc' }])
    const two = bumpOverviewSort([{ k: 'gap', dir: 'desc' }], 'due')
    expect(two).toEqual([{ k: 'gap', dir: 'desc' }, { k: 'due', dir: 'asc' }])
    expect(bumpOverviewSort(two, 'gap')[0]).toEqual({ k: 'gap', dir: 'asc' })
  })
})
