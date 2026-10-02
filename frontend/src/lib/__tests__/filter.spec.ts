import { describe, expect, it } from 'vitest'
import {
  anyTaskFilter,
  filterableMembers,
  matchTask,
  toggleIn,
  type TaskFilter,
} from '@/lib/filter'
import type { Member, Task } from '@/types/models'

const base: TaskFilter = {
  memberIds: [],
  statuses: [],
  priorities: [],
  groupIds: [],
  issueMode: 'all',
  dateMode: 'off',
  d1: '',
  d2: '',
}
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  groupId: 'g1',
  name: 't1',
  created: '2026-09-01',
  start: '2026-09-10',
  end: '2026-09-20',
  status: 'todo',
  done: '',
  priority: 'mid',
  assigneeIds: ['m1'],
  duration: 1,
  baselineStart: '',
  baselineEnd: '',
  ...over,
})
const ctx = (openIssueCount = 0) => ({
  openIssueCount: () => openIssueCount,
})

describe('matchTask', () => {
  it('memberIds 空時全過，有值時取交集', () => {
    expect(matchTask(task(), base, ctx())).toBe(true)
    expect(matchTask(task(), { ...base, memberIds: ['m1'] }, ctx())).toBe(true)
    expect(matchTask(task(), { ...base, memberIds: ['m2'] }, ctx())).toBe(false)
  })

  it('statuses 認得 delayed 這個假狀態', () => {
    expect(matchTask(task(), { ...base, statuses: ['todo'] }, ctx())).toBe(true)
    expect(matchTask(task(), { ...base, statuses: ['done'] }, ctx())).toBe(false)
    // 延遲依基準：推算結束日晚於基準結束日
    const late = task({ end: '2026-09-18', baselineEnd: '2026-09-16' })
    expect(matchTask(late, { ...base, statuses: ['delayed'] }, ctx())).toBe(true)
    expect(matchTask(task(), { ...base, statuses: ['delayed'] }, ctx())).toBe(false)
  })

  it('priorities 逐項比對', () => {
    expect(matchTask(task(), { ...base, priorities: ['mid'] }, ctx())).toBe(true)
    expect(matchTask(task(), { ...base, priorities: ['high'] }, ctx())).toBe(false)
  })

  it('groupIds 逐項比對', () => {
    expect(matchTask(task(), { ...base, groupIds: ['g1'] }, ctx())).toBe(true)
    expect(matchTask(task(), { ...base, groupIds: ['g2'] }, ctx())).toBe(false)
  })

  it('issueMode has 只留有未結 Issue 的任務', () => {
    expect(matchTask(task(), { ...base, issueMode: 'has' }, ctx(2))).toBe(true)
    expect(matchTask(task(), { ...base, issueMode: 'has' }, ctx(0))).toBe(false)
  })

  it('issueMode none 只留沒有未結 Issue 的任務', () => {
    expect(matchTask(task(), { ...base, issueMode: 'none' }, ctx(0))).toBe(true)
    expect(matchTask(task(), { ...base, issueMode: 'none' }, ctx(1))).toBe(false)
  })

  it('dateMode gt 比的是 end', () => {
    const f: TaskFilter = { ...base, dateMode: 'gt', d1: '2026-09-15' }
    expect(matchTask(task(), f, ctx())).toBe(true)
    expect(matchTask(task({ end: '2026-09-14' }), f, ctx())).toBe(false)
    expect(matchTask(task({ end: '2026-09-14' }), { ...f, d1: '' }, ctx())).toBe(true)
  })

  it('dateMode lt 比的是 start', () => {
    const f: TaskFilter = { ...base, dateMode: 'lt', d1: '2026-09-15' }
    expect(matchTask(task(), f, ctx())).toBe(true)
    expect(matchTask(task({ start: '2026-09-16' }), f, ctx())).toBe(false)
  })

  it('dateMode between 取區間重疊，且 d1 / d2 順序可顛倒', () => {
    const f: TaskFilter = { ...base, dateMode: 'between', d1: '2026-09-18', d2: '2026-09-12' }
    expect(matchTask(task(), f, ctx())).toBe(true)
    expect(matchTask(task({ start: '2026-09-25', end: '2026-09-30' }), f, ctx())).toBe(false)
    expect(
      matchTask(task({ start: '2026-09-25', end: '2026-09-30' }), { ...f, d2: '' }, ctx()),
    ).toBe(true)
  })
})

describe('anyTaskFilter', () => {
  it('全部初始值時為 false', () => expect(anyTaskFilter(base)).toBe(false))

  it('任一欄有值就為 true', () => {
    expect(anyTaskFilter({ ...base, memberIds: ['m1'] })).toBe(true)
    expect(anyTaskFilter({ ...base, statuses: ['todo'] })).toBe(true)
    expect(anyTaskFilter({ ...base, priorities: ['low'] })).toBe(true)
    expect(anyTaskFilter({ ...base, groupIds: ['g1'] })).toBe(true)
    expect(anyTaskFilter({ ...base, issueMode: 'has' })).toBe(true)
    expect(anyTaskFilter({ ...base, dateMode: 'gt' })).toBe(true)
  })
})

describe('toggleIn', () => {
  it('沒有就加在最後、有就拿掉；不改原陣列', () => {
    const list = ['a', 'b']
    expect(toggleIn(list, 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleIn(list, 'a')).toEqual(['b'])
    expect(list).toEqual(['a', 'b'])
  })
})

describe('filterableMembers', () => {
  const m = (id: string): Member => ({ id, name: id, role: '', color: '#000000', active: true })
  const members = [m('m1'), m('m2'), m('m3'), m('m4')]
  const tasks = [
    { assigneeIds: ['m3', 'm1'] },
    { assigneeIds: [] },
    { assigneeIds: ['m3'] },
  ] as unknown as Task[]

  it('只列有被指派任務的成員，順序照 members（不照任務裡的順序）', () => {
    expect(filterableMembers(members, tasks, []).map((x) => x.id)).toEqual(['m1', 'm3'])
  })

  it('已勾選的人就算沒有任務了也留著，才取消得掉', () => {
    expect(filterableMembers(members, tasks, ['m4']).map((x) => x.id)).toEqual(['m1', 'm3', 'm4'])
  })
})
