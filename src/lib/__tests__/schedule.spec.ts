import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import {
  applyTaskPatch,
  cascade,
  isLate,
  isLateIssue,
  needsCascade,
  projectRange,
  reachable,
} from '@/lib/schedule'
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
    const { tasks: out } = applyTaskPatch(tasks, [], 'a', { status: 'done' }, '2026-09-18')
    expect(out.find((x) => x.id === 'a')!.done).toBe('2026-09-18')
    const { tasks: back } = applyTaskPatch(out, [], 'a', { status: 'doing' }, '2026-09-18')
    expect(back.find((x) => x.id === 'a')!.done).toBe('')
  })

  it('applyTaskPatch 已填過的 done 不被覆蓋', () => {
    const tasks = [{ ...t('a', '2026-09-01', '2026-09-05'), done: '2026-09-03' }]
    const { tasks: out } = applyTaskPatch(tasks, [], 'a', { status: 'done' }, '2026-09-18')
    expect(out[0]!.done).toBe('2026-09-03')
  })

  it('applyTaskPatch: start 早於前置 start 時整段平移保工期', () => {
    const tasks = [t('a', '2026-09-10', '2026-09-14'), t('b', '2026-09-15', '2026-09-19')]
    const { tasks: out } = applyTaskPatch(
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
    const { tasks: out } = applyTaskPatch(
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
    const out = applyTaskPatch(tasks, [], 'zz', { status: 'done' }, '2026-09-18')
    expect(out.tasks).toBe(tasks)
    expect(out.changed).toEqual([])
  })
})

// spec 目標 7：只有 start / end / status 變動才跑 cascade，其餘欄位就地 patch；
// 未變動的任務保留物件 identity，元件的 computed 才不會整批重算。
describe('needsCascade', () => {
  it('只有 start / end / status 需要 cascade', () => {
    expect(needsCascade({ name: '改名' })).toBe(false)
    expect(needsCascade({ priority: 'high' })).toBe(false)
    expect(needsCascade({ assigneeIds: ['m1'] })).toBe(false)
    expect(needsCascade({ done: '2026-09-18' })).toBe(false)
    expect(needsCascade({ groupId: 'g2' })).toBe(false)
    expect(needsCascade({})).toBe(false)
    expect(needsCascade({ end: '2026-09-09' })).toBe(true)
    expect(needsCascade({ start: '2026-09-02' })).toBe(true)
    expect(needsCascade({ status: 'done' })).toBe(true)
    expect(needsCascade({ name: 'x', start: '2026-09-02' })).toBe(true)
  })
})

describe('applyTaskPatch 的 identity 與 changed', () => {
  const trio = () => [
    t('a', '2026-09-01', '2026-09-05'),
    t('b', '2026-09-06', '2026-09-08'),
    t('c', '2026-09-20', '2026-09-22', 'g2'),
  ]

  it('改名不跑 cascade：只有被改的那筆是新物件，其餘 identity 相同', () => {
    const tasks = trio()
    const { tasks: out, changed } = applyTaskPatch(
      tasks,
      [d('a', 'b')],
      'a',
      { name: '改名' },
      '2026-09-18',
    )
    expect(out[0]).not.toBe(tasks[0])
    expect(out[0]!.name).toBe('改名')
    expect(out[0]!.start).toBe('2026-09-01')
    expect(out[1]).toBe(tasks[1])
    expect(out[2]).toBe(tasks[2])
    expect(changed).toEqual([out[0]])
    // 入參不被改
    expect(tasks[0]!.name).toBe('a')
  })

  it('start 變動時下游被推，沒被影響的任務 identity 相同', () => {
    const tasks = trio()
    const { tasks: out, changed } = applyTaskPatch(
      tasks,
      [d('a', 'b')],
      'a',
      { start: '2026-09-04', end: '2026-09-08' },
      '2026-09-18',
    )
    expect(out[0]!.start).toBe('2026-09-04')
    expect(out[1]!.start).toBe('2026-09-09')
    expect(out[2]).toBe(tasks[2])
    expect(changed.map((x) => x.id)).toEqual(['a', 'b'])
    expect(changed[0]).toBe(out[0])
    expect(changed[1]).toBe(out[1])
  })

  it('patch 送的值跟現況一樣時什麼都不變，回原陣列與空 changed', () => {
    const tasks = trio()
    const { tasks: out, changed } = applyTaskPatch(
      tasks,
      [d('a', 'b')],
      'a',
      { name: 'a', assigneeIds: [] },
      '2026-09-18',
    )
    expect(out).toBe(tasks)
    expect(changed).toEqual([])
  })

  it('status 變動會跑 cascade，changed 只含真的變了的任務', () => {
    const tasks = trio()
    const { tasks: out, changed } = applyTaskPatch(
      tasks,
      [d('a', 'b')],
      'a',
      { status: 'done' },
      '2026-09-18',
    )
    expect(out[0]!.done).toBe('2026-09-18')
    expect(changed.map((x) => x.id)).toEqual(['a'])
    expect(out[1]).toBe(tasks[1])
    expect(out[2]).toBe(tasks[2])
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
