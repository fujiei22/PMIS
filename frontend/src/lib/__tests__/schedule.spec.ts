import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { isLateIssue, projectRange, reachable } from '@/lib/schedule'
import type { Dependency, Issue, Task } from '@/types/models'

const t = (id: string, start: string, end: string, groupId = 'g1'): Task => ({
  id,
  groupId,
  name: id,
  created: start,
  start,
  end,
  status: 'todo',
  done: '',
  priority: 'mid',
  assigneeIds: [],
  duration: 1,
  baselineStart: '',
  baselineEnd: '',
})
const d = (from: string, to: string): Dependency => ({ id: from + to, from, to })
const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i1',
  taskId: 'a',
  created: '2026-09-01',
  title: 'x',
  item: 'F',
  level: 'C',
  creatorId: 'm1',
  ownerIds: [],
  status: 'open',
  due: '2026-09-16',
  done: '',
  ptype: '',
  pcb: '',
  bios: '',
  os: '',
  desc: '',
  solution: '',
  solvedBios: '',
  ...over,
})
const TODAY = dayIndex('2026-09-18')

describe('reachable', () => {
  it('reachable 偵測循環', () => {
    // reachable(from, to)：從 from 沿相依走得到 to 嗎。addDep(x, y) 用 reachable(y, x) 擋循環。
    expect(reachable('a', 'c', [d('a', 'b'), d('b', 'c')])).toBe(true)
    expect(reachable('c', 'a', [d('a', 'b'), d('b', 'c')])).toBe(false)
    expect(reachable('a', 'c', [d('a', 'b')])).toBe(false)
  })

  it('reachable 遇自我循環的資料不會無限遞迴', () => {
    expect(reachable('a', 'z', [d('a', 'b'), d('b', 'a')])).toBe(false)
  })
})

// 任務的延遲與計畫進度改依基準，測試在 scheduleRules.spec
describe('isLateIssue / projectRange', () => {
  it('isLateIssue：還沒結案而且期限已經過去', () => {
    expect(isLateIssue(issue(), TODAY)).toBe(true)
    expect(isLateIssue(issue({ status: 'closed' }), TODAY)).toBe(false)
    expect(isLateIssue(issue({ due: '' }), TODAY)).toBe(false)
    expect(isLateIssue(issue({ due: '2026-09-30' }), TODAY)).toBe(false)
  })

  it('projectRange 空陣列回今天起 20 天', () => {
    const r = projectRange([], 20700)
    expect(r.b - r.a).toBe(27)
    expect(r.min).toBe(20700)
    expect(r.max).toBe(20720)
  })

  it('projectRange 前留 3 天、後留 4 天', () => {
    const r = projectRange([t('a', '2026-09-01', '2026-09-05')], TODAY)
    expect(r.min).toBe(dayIndex('2026-09-01'))
    expect(r.max).toBe(dayIndex('2026-09-05'))
    expect(r.a).toBe(r.min - 3)
    expect(r.b).toBe(r.max + 4)
  })
})
