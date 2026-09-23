import { describe, expect, it } from 'vitest'
import { buildPortfolio, summarizeProject } from '@/api/mock/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { PMIS_META } from '@/mocks/samplePortfolio'
import type { ProjectData } from '@/types/models'

/**
 * mock 扮演後端的彙整邏輯（spec 7b）：PMIS 摘要由完整專案資料即時算出，
 * Dashboard 改了任務，總覽重載時就看得到。規則同 api/types.ts 檔頭的 wire 約定。
 */

describe('summarizeProject', () => {
  it('sampleProject 在 2026-09-22：30 任務、完成 4、應完成 7、延遲 3', () => {
    const p = summarizeProject(sampleProject, PMIS_META, '2026-09-22')
    expect(p).toMatchObject({ id: 'pmis', pmId: 'm5', taskTotal: 30, taskDone: 4, taskPlanned: 7, delayedTasks: 3,
      startDate: '2026-08-24', dueDate: '2026-11-10' })
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
  it('沒有任務時起訖日都是今天、各數字為 0', () => {
    const data: ProjectData = { ...structuredClone(sampleProject), tasks: [], issues: [] }
    expect(summarizeProject(data, PMIS_META, '2026-09-22')).toMatchObject({
      startDate: '2026-09-22', dueDate: '2026-09-22', taskTotal: 0, taskPlanned: 0, upcoming: [] })
  })
  it('buildPortfolio：7 個專案、11 位成員、登入者 m11', () => {
    const pf = buildPortfolio(sampleProject, '2026-09-22')
    expect(pf.projects.map((p) => p.id)).toEqual(['pmis', 'portal', 'payment', 'dw', 'app', 'wiki', 'vendor'])
    expect(pf.members).toHaveLength(11)
    expect(pf.currentUserId).toBe('m11')
  })
})
