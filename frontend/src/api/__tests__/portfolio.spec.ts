import { describe, expect, it } from 'vitest'
import { buildPortfolio, projectStatusOf, summarizeProject } from '@/api/mock/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { PMIS_META } from '@/mocks/samplePortfolio'
import type { ProjectData } from '@/types/models'

/**
 * mock 扮演後端的彙整邏輯（spec 7b）：PMIS 摘要由完整專案資料即時算出，
 * Dashboard 改了任務，總覽重載時就看得到。規則同 api/types.ts 檔頭的 wire 約定。
 */

/** 專案狀態依任務算（decisions：不存欄位；Q11：沒有任務或全部暫停算未開始）。後端照同一份規則寫。 */
describe('projectStatusOf', () => {
  const c = (done: number, doing: number, paused: number, todo: number) => ({
    done,
    doing,
    paused,
    todo,
  })
  it.each([
    ['全部完成', c(3, 0, 0, 0), 'done'],
    ['有進行中', c(0, 1, 0, 5), 'doing'],
    ['有完成但還沒全部完成', c(2, 0, 1, 3), 'doing'],
    ['全部未開始', c(0, 0, 0, 4), 'todo'],
    ['只有暫停', c(0, 0, 2, 0), 'todo'],
    ['暫停加未開始', c(0, 0, 1, 1), 'todo'],
    ['沒有任務', c(0, 0, 0, 0), 'todo'],
  ] as const)('%s → %s', (_name, counts, want) => {
    expect(projectStatusOf(counts)).toBe(want)
  })
})

describe('summarizeProject', () => {
  it('sampleProject 在 2026-09-22：30 任務、完成 4、應完成 7、延遲 3', () => {
    const p = summarizeProject(sampleProject, PMIS_META, '2026-09-22')
    expect(p).toMatchObject({
      id: 'pmis',
      pmId: 'm5',
      taskTotal: 30,
      taskDone: 4,
      taskPlanned: 7,
      delayedTasks: 3,
      startDate: '2026-08-24',
      dueDate: '2026-11-10',
      status: 'doing',
    })
    expect(p.taskCounts).toEqual({ done: 4, doing: 8, paused: 1, todo: 17 })
    expect(p.openIssues).toEqual({ A: 2, B: 3, C: 4, D: 1 })
    expect(p.upcoming).toHaveLength(3)
  })
  it('upcoming 含逾期、依到期日升冪、不含已完成', () => {
    const p = summarizeProject(sampleProject, PMIS_META, '2026-09-22')
    const dues = p.upcoming.map((u) => u.due)
    expect([...dues].sort()).toEqual(dues)
    const doneNames = sampleProject.tasks.filter((t) => t.status === 'done').map((t) => t.name)
    expect(p.upcoming.some((u) => doneNames.includes(u.name))).toBe(false)
  })
  it('改了任務狀態，彙整結果跟著變（總覽回來看得到 Dashboard 的改動）', () => {
    const data: ProjectData = structuredClone(sampleProject)
    const t = data.tasks.find((x) => x.status !== 'done')!
    t.status = 'done'
    expect(summarizeProject(data, PMIS_META, '2026-09-22').taskDone).toBe(5)
  })
  it('status 跟著任務狀態變：全部完成 → done、全部清掉 → todo', () => {
    const data: ProjectData = structuredClone(sampleProject)
    for (const t of data.tasks) t.status = 'done'
    expect(summarizeProject(data, PMIS_META, '2026-09-22').status).toBe('done')
    data.tasks = []
    expect(summarizeProject(data, PMIS_META, '2026-09-22').status).toBe('todo')
  })
  it('沒有任務時起訖日都是今天、各數字為 0', () => {
    const data: ProjectData = { ...structuredClone(sampleProject), tasks: [], issues: [] }
    expect(summarizeProject(data, PMIS_META, '2026-09-22')).toMatchObject({
      startDate: '2026-09-22',
      dueDate: '2026-09-22',
      taskTotal: 0,
      taskPlanned: 0,
      upcoming: [],
    })
  })
  it('buildPortfolio：7 個專案、11 位成員、登入者 m11', () => {
    const pf = buildPortfolio(sampleProject, '2026-09-22')
    expect(pf.projects.map((p) => p.id)).toEqual([
      'pmis',
      'portal',
      'payment',
      'dw',
      'app',
      'wiki',
      'vendor',
    ])
    expect(pf.members).toHaveLength(11)
    expect(pf.currentUserId).toBe('m11')
  })

  it('日期空白的任務不影響起訖日與近期任務（不會算出 NaN）', () => {
    const data: ProjectData = structuredClone(sampleProject)
    data.tasks[0]!.start = ''
    data.tasks[1]!.end = ''
    const p = summarizeProject(data, PMIS_META, '2026-09-22')
    expect(p.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(p.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(p.upcoming.every((u) => u.due !== '')).toBe(true)
    expect(Number.isNaN(p.taskPlanned)).toBe(false)
  })
})
