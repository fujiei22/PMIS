import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { applyTaskPatch, cascade, isLate, isLateIssue, projectRange, reachable } from '@/lib/schedule'
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

describe('cascade', () => {
  it('cascade 把下游推到不早於上游 start，並保工期、不改入參', () => {
    const tasks = [t('a', '2026-09-01', '2026-09-05'), t('b', '2026-09-03', '2026-09-06')]
    const out = cascade(tasks, [d('a', 'b')], { a: 4 })
    expect(out[1]!.start).toBe('2026-09-07')
    expect(out[1]!.end).toBe('2026-09-10')
    expect(tasks[1]!.start).toBe('2026-09-03')
  })

  it('cascade 空陣列回空', () => expect(cascade([], [], {})).toEqual([]))

  it('cascade 把早於上游 start 的下游拉到 floor', () => {
    const tasks = [t('a', '2026-09-10', '2026-09-12'), t('b', '2026-09-01', '2026-09-03')]
    const out = cascade(tasks, [d('a', 'b')])
    expect(out[1]!.start).toBe('2026-09-10')
    expect(out[1]!.end).toBe('2026-09-12')
  })

  it('cascade 沿相依鏈一路傳遞', () => {
    const tasks = [
      t('a', '2026-09-01', '2026-09-05'),
      t('b', '2026-09-06', '2026-09-08'),
      t('c', '2026-09-09', '2026-09-10'),
    ]
    const out = cascade(tasks, [d('a', 'b'), d('b', 'c')], { a: 3 })
    expect(out[1]!.start).toBe('2026-09-09')
    expect(out[2]!.start).toBe('2026-09-12')
  })

  it('cascade 不動沒有前置的任務', () => {
    const tasks = [t('a', '2026-09-01', '2026-09-05')]
    expect(cascade(tasks, [], { a: 5 })[0]!.start).toBe('2026-09-01')
  })
})

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

describe('applyTaskPatch', () => {
  it('applyTaskPatch: status→done 填 done；離開 done 清空', () => {
    const tasks = [t('a', '2026-09-01', '2026-09-05')]
    const out = applyTaskPatch(tasks, [], 'a', { status: 'done' }, '2026-09-18')
    expect(out.find((x) => x.id === 'a')!.done).toBe('2026-09-18')
    const back = applyTaskPatch(out, [], 'a', { status: 'doing' }, '2026-09-18')
    expect(back.find((x) => x.id === 'a')!.done).toBe('')
  })

  it('applyTaskPatch 已填過的 done 不被覆蓋', () => {
    const tasks = [{ ...t('a', '2026-09-01', '2026-09-05'), done: '2026-09-03' }]
    const out = applyTaskPatch(tasks, [], 'a', { status: 'done' }, '2026-09-18')
    expect(out[0]!.done).toBe('2026-09-03')
  })

  it('applyTaskPatch: start 早於前置 start 時整段平移保工期', () => {
    const tasks = [t('a', '2026-09-10', '2026-09-14'), t('b', '2026-09-15', '2026-09-19')]
    const out = applyTaskPatch(
      tasks,
      [d('a', 'b')],
      'b',
      { start: '2026-09-01', end: '2026-09-05' },
      '2026-09-18',
    )
    const b = out.find((x) => x.id === 'b')!
    expect(b.start).toBe('2026-09-10')
    expect(b.end).toBe('2026-09-14')
  })

  it('applyTaskPatch 移動上游時下游跟著移', () => {
    const tasks = [t('a', '2026-09-01', '2026-09-05'), t('b', '2026-09-06', '2026-09-08')]
    const out = applyTaskPatch(
      tasks,
      [d('a', 'b')],
      'a',
      { start: '2026-09-04', end: '2026-09-08' },
      '2026-09-18',
    )
    expect(out.find((x) => x.id === 'b')!.start).toBe('2026-09-09')
  })

  it('applyTaskPatch 找不到 id 時原樣回傳', () => {
    const tasks = [t('a', '2026-09-01', '2026-09-05')]
    expect(applyTaskPatch(tasks, [], 'zz', { status: 'done' }, '2026-09-18')).toBe(tasks)
  })
})

describe('isLate / isLateIssue / projectRange', () => {
  it('isLate / isLateIssue', () => {
    expect(isLate(t('a', '2026-09-01', '2026-09-16'), TODAY)).toBe(true)
    expect(isLate(t('a', '2026-09-01', '2026-09-20'), TODAY)).toBe(false)
    expect(isLate({ ...t('a', '2026-09-01', '2026-09-16'), status: 'done' }, TODAY)).toBe(false)
    expect(isLate({ ...t('a', '2026-09-01', '2026-09-16'), end: '' }, TODAY)).toBe(false)
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
