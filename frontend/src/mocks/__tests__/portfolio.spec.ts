import { describe, expect, it } from 'vitest'
import { buildPortfolio } from '@/api/mock/portfolio'
import { deriveProject } from '@/lib/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { PORTFOLIO_MEMBERS, STATIC_PROJECTS } from '@/mocks/samplePortfolio'

/** 設計稿（content.md 第三輪）的數字；靜態專案的任務數改了就會在這裡紅。PMIS 改為即時彙整，不在此列。 */
const EXPECTED: Record<string, [number, number, number, string]> = {
  portal: [62, 75, 13, 'watch'],
  payment: [28, 32, 4, 'none'],
  dw: [100, 100, 0, 'none'],
  app: [4, 5, 1, 'none'],
  wiki: [60, 88, 28, 'late'],
  vendor: [0, 0, 0, 'none'],
}

describe('samplePortfolio', () => {
  it.each(Object.entries(EXPECTED))('%s 的實際 / 理論 / 落後 / 需注意與設計稿一致', (id, want) => {
    const p = STATIC_PROJECTS.find((x) => x.id === id)!
    const d = deriveProject(p, '2026-09-22')
    expect([d.actualPct, d.plannedPct, d.gap, d.alert]).toEqual(want)
  })
  it('靜態專案：任務狀態數加總＝總數；PM 與成員 id 都查得到', () => {
    const ids = new Set(PORTFOLIO_MEMBERS.map((m) => m.id))
    for (const p of STATIC_PROJECTS) {
      const c = p.taskCounts
      expect(c.done + c.doing + c.paused + c.todo).toBe(p.taskTotal)
      expect(c.done).toBe(p.taskDone)
      expect(ids.has(p.pmId)).toBe(true)
      for (const id of [...p.memberIds, ...p.upcoming.map((u) => u.memberId)])
        expect(ids.has(id)).toBe(true)
    }
  })
  it('m1–m7 就是 sampleProject 的成員（同一份，不會走樣）', () => {
    expect(PORTFOLIO_MEMBERS.slice(0, 7)).toEqual(sampleProject.members)
  })
  it('PMIS 在 09-22 是 late（延遲 3），09-18 是 watch（A 級 Issue）', () => {
    const at = (today: string) =>
      deriveProject(buildPortfolio(sampleProject, today).projects[0]!, today)
    expect(at('2026-09-22')).toMatchObject({
      actualPct: 13,
      plannedPct: 23,
      gap: 10,
      alert: 'late',
    })
    expect(at('2026-09-18')).toMatchObject({
      actualPct: 13,
      plannedPct: 20,
      gap: 7,
      alert: 'watch',
    })
  })
})
