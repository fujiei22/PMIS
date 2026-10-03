import { describe, expect, it } from 'vitest'
import { dayIndex, isoFromIndex } from '@/lib/date'
import {
  isLate,
  isPlannedDone,
  planTasks,
  scheduleProject,
  scheduleTasks,
  scheduleWithPlan,
  type ScheduleMeta,
} from '@/lib/schedule'
import { createWorkdays } from '@/lib/workdays'
import { sampleCalendar } from '@/mocks/sampleCalendar'
import { sampleProject } from '@/mocks/sampleProject'

/** 範例日曆的工作天運算；dev 與測試固定的今天是 2026-09-18。 */
const WD = createWorkdays(sampleCalendar)
const TODAY = dayIndex('2026-09-18')

/**
 * mocks 自身的一致性守衛。
 *
 * spec 目標 5：載入不寫回，資料以後端為準。畫面上的任務是用今天重排的結果（規則見
 * docs/reference/scheduling.md），所以範例存的起訖必須「已經是 2026-09-18 排過的樣子」——
 * 否則 dev 與測試一載入畫面就跟存的值不一樣。有人改了範例的日期、工期或相依而沒對齊，這裡會先紅。
 * 也釘住範例在三個檢查點的排程說明（每個任務的開始日、結束日由哪條規則決定）。
 */
describe('sampleProject 一致性', () => {
  it('2026-09-18 照新排程重排不會改動任何任務（存的起訖就是推算結果）', () => {
    const after = scheduleTasks(sampleProject.tasks, sampleProject.deps, WD, TODAY)
    expect(after.map((t) => ({ id: t.id, start: t.start, end: t.end }))).toEqual(
      sampleProject.tasks.map((t) => ({ id: t.id, start: t.start, end: t.end })),
    )
  })

  it('未開始的下游，開始日晚於每個上游的結束日（完成到開始）', () => {
    const by = new Map(sampleProject.tasks.map((t) => [t.id, t]))
    const bad: string[] = []
    for (const d of sampleProject.deps) {
      const from = by.get(d.from)
      const to = by.get(d.to)
      if (!from || !to) bad.push(`${d.id}：端點不存在`)
      else if (to.status === 'todo' && dayIndex(to.start) <= dayIndex(from.end))
        bad.push(`${d.id}：${to.id} 開始 ${to.start} 不晚於 ${from.id} 結束 ${from.end}`)
    }
    expect(bad).toEqual([])
  })

  it('每筆都有工期與計畫；完成的結束日就是完成日', () => {
    const bad = sampleProject.tasks
      .filter(
        (t) =>
          t.duration < 1 ||
          !t.baselineStart ||
          !t.baselineEnd ||
          (t.status === 'done' ? t.end !== t.done : t.done !== ''),
      )
      .map((t) => t.id)
    expect(bad).toEqual([])
  })

  // 存的計畫等於照計畫開始日、工期、相依排出來的結果：載入後第一次編輯不會順便改寫一堆任務的計畫
  it('存的計畫（基準欄位）＝ planTasks 的結果', () => {
    const plan = planTasks(sampleProject.tasks, sampleProject.deps, WD, dayIndex('2026-09-18'))
    const bad = sampleProject.tasks
      .filter((t) => {
        const p = plan.get(t.id)!
        return p.start !== t.baselineStart || p.end !== t.baselineEnd
      })
      .map((t) => t.id)
    expect(bad).toEqual([])
  })

  // 三個檢查點：延遲與計畫進度（依計畫）跟著今天變。總覽與 SummaryCards 的數字由這裡出發
  it.each([
    ['2026-09-18', ['t13'], 5],
    ['2026-09-19', ['t8', 't13'], 6],
    ['2026-09-22', ['t8', 't13'], 6],
  ] as const)('%s：延遲 %j、計畫應完成 %i 筆', (today, late, planned) => {
    const idx = dayIndex(today)
    const tasks = scheduleWithPlan(sampleProject.tasks, sampleProject.deps, WD, idx)
    expect(tasks.filter((t) => isLate(t)).map((t) => t.id)).toEqual(late)
    expect(tasks.filter((t) => isPlannedDone(t, idx))).toHaveLength(planned)
  })

  it('2026-09-22 的專案結束日是 11-18', () => {
    const tasks = scheduleTasks(sampleProject.tasks, sampleProject.deps, WD, dayIndex('2026-09-22'))
    const ends = tasks.map((t) => t.end).sort()
    expect(ends[ends.length - 1]).toBe('2026-11-18')
  })

  it('id 在每一種資料裡都唯一，且跨種類不重複', () => {
    const all = [
      ...sampleProject.groups.map((x) => x.id),
      ...sampleProject.members.map((x) => x.id),
      ...sampleProject.tasks.map((x) => x.id),
      ...sampleProject.deps.map((x) => x.id),
      ...sampleProject.issues.map((x) => x.id),
      ...sampleProject.comments.map((x) => x.id),
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it('外鍵都指得到：task.groupId / issue.taskId / comment.targetId / 成員', () => {
    const groupIds = new Set(sampleProject.groups.map((g) => g.id))
    const taskIds = new Set(sampleProject.tasks.map((t) => t.id))
    const issueIds = new Set(sampleProject.issues.map((i) => i.id))
    const memberIds = new Set(sampleProject.members.map((m) => m.id))

    for (const t of sampleProject.tasks) {
      expect(groupIds.has(t.groupId)).toBe(true)
      for (const m of t.assigneeIds) expect(memberIds.has(m)).toBe(true)
    }
    for (const i of sampleProject.issues) {
      expect(taskIds.has(i.taskId)).toBe(true)
      expect(memberIds.has(i.creatorId)).toBe(true)
      for (const m of i.ownerIds) expect(memberIds.has(m)).toBe(true)
    }
    for (const c of sampleProject.comments) {
      expect(memberIds.has(c.memberId)).toBe(true)
      expect(c.targetKind === 'task' ? taskIds.has(c.targetId) : issueIds.has(c.targetId)).toBe(
        true,
      )
    }
    expect(memberIds.has(sampleProject.currentUserId)).toBe(true)
  })

  // 契約 A：附件要有 id，api.downloadAttachment(attachmentId) 才有東西可指。
  it('每個附件都有 id，格式是 <commentId>:<index> 且全域唯一', () => {
    const seen = new Set<string>()
    let count = 0
    for (const c of sampleProject.comments) {
      c.files.forEach((f, i) => {
        count++
        expect(f.id).toBe(`${c.id}:${i}`)
        expect(seen.has(f.id)).toBe(false)
        seen.add(f.id)
      })
    }
    expect(count).toBeGreaterThan(0)
  })
})

/** 說明寫成一行：「任務 開始規則[:前置] 結束規則[:原定結束 MM-DD]」。 */
function fmtMeta(id: string, m: ScheduleMeta): string {
  const start = m.predId ? `${m.startBy}:${m.predId}` : m.startBy
  const end =
    m.originalEnd !== undefined ? `${m.endBy}:${isoFromIndex(m.originalEnd).slice(5)}` : m.endBy
  return `${id} ${start} ${end}`
}

/**
 * 範例在三個檢查點的排程說明（開始日、結束日由哪條規則決定；規則見 docs/reference/scheduling.md〈開始日〉〈結束日〉）。
 * 排程規則改了，這張表跟著變是預期的：先改 scheduling.md，再看測試的 diff 逐筆核對、更新這裡（格式見 fmtMeta）。
 * 只是重構卻讓這裡紅，就是行為變了。09-19、09-22 只有 t8 不同（09-18 該結束卻還沒完成，變成逾期）；
 * 規則一變、三天的差異多了，就拆成三張表。
 */
const META_0918 = [
  't1 actual done',
  't2 actual done',
  't3 actual overdue:09-16',
  't4 actual duration',
  't5 pred:t4 duration',
  't6 pred:t5 duration',
  't7 actual done',
  't8 actual duration',
  't9 actual duration',
  't10 pred:t9 duration',
  't11 pred:t10 duration',
  't12 pred:t11 duration',
  't13 actual overdue:09-11',
  't14 actual duration',
  't15 pred:t14 duration',
  't16 pred:t15 duration',
  't17 pred:t16 duration',
  't18 actual duration',
  't19 pred:t18 duration',
  't20 pred:t19 duration',
  't21 pred:t20 duration',
  't22 pred:t21 duration',
  't23 pred:t22 duration',
  't24 root duration',
  't25 pred:t24 duration',
  't26 pred:t25 duration',
  't27 pred:t23 duration',
  't28 actual done',
  't29 actual duration',
  't30 root duration',
]
const META_LATER = META_0918.map((s) => (s.startsWith('t8 ') ? 't8 actual overdue:09-18' : s))

describe('排程說明（scheduleProject 的 meta）', () => {
  for (const [day, want] of [
    ['2026-09-18', META_0918],
    ['2026-09-19', META_LATER],
    ['2026-09-22', META_LATER],
  ] as const) {
    it(`${day}：每個任務的開始、結束規則；沒有被略過的相依`, () => {
      const r = scheduleProject(sampleProject.tasks, sampleProject.deps, WD, dayIndex(day))
      expect(sampleProject.tasks.map((t) => fmtMeta(t.id, r.meta.get(t.id)!))).toEqual(want)
      expect(r.skipped).toEqual([])
    })
  }
})
