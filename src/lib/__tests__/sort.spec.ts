import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import {
  applySort,
  bumpSort,
  DEFAULT_ISSUE_SORT,
  DEFAULT_TASK_SORT,
  sortValue,
  type SortCtx,
  type SortKey,
} from '@/lib/sort'
import type { Issue, Member, Task } from '@/types/models'

const task = (over: Partial<Task> & { id: string }): Task => ({
  groupId: 'g1',
  name: over.id,
  created: '2026-09-01',
  start: '2026-09-10',
  end: '2026-09-12',
  status: 'todo',
  done: '',
  priority: 'mid',
  assigneeIds: [],
  ...over,
})
const issue = (over: Partial<Issue> & { id: string }): Issue => ({
  taskId: 't1',
  created: '2026-09-01',
  title: over.id,
  item: 'F',
  level: 'C',
  creatorId: 'm1',
  ownerIds: [],
  status: 'open',
  due: '2026-09-20',
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
const members: Member[] = [
  { id: 'm1', name: '甲', role: '', color: '#000' },
  { id: 'm2', name: '乙', role: '', color: '#000' },
]
const tasks = [task({ id: 't1', start: '2026-09-01' }), task({ id: 't2', start: '2026-09-09' })]
const ctx: SortCtx = {
  taskById: (id) => tasks.find((t) => t.id === id),
  memberById: (id) => members.find((m) => m.id === id),
  openIssueCount: (id) => (id === 't1' ? 3 : 0),
}

describe('sortValue', () => {
  it('任務各鍵取到對的值', () => {
    const t = task({ id: 't1', start: '2026-09-10', end: '2026-09-12', priority: 'high' })
    expect(sortValue('task', 'start', t, ctx)).toBe(dayIndex('2026-09-10'))
    expect(sortValue('task', 'days', t, ctx)).toBe(3)
    expect(sortValue('task', 'priority', t, ctx)).toBe(3)
    expect(sortValue('task', 'issue', t, ctx)).toBe(3)
    expect(sortValue('task', 'created', t, ctx)).toBe(dayIndex('2026-09-01'))
    expect(sortValue('task', 'name', t, ctx)).toBe('t1')
    expect(sortValue('task', '不存在的鍵', t, ctx)).toBe(0)
  })

  it('Issue 的 priority 這個排序鍵讀的是 level', () => {
    expect(sortValue('issue', 'priority', issue({ id: 'i1', level: 'A' }), ctx)).toBe(4)
    expect(sortValue('issue', 'priority', issue({ id: 'i2', level: 'D' }), ctx)).toBe(1)
  })

  it('Issue 其餘鍵取到對的值', () => {
    const i = issue({ id: 'i1', item: 'C', status: 'paused', taskId: 't2', creatorId: 'm2' })
    expect(sortValue('issue', 'item', i, ctx)).toBe(4)
    expect(sortValue('issue', 'due', i, ctx)).toBe(dayIndex('2026-09-20'))
    expect(sortValue('issue', 'due', issue({ id: 'i2', due: '' }), ctx)).toBe(9e9)
    expect(sortValue('issue', 'status', i, ctx)).toBe(2)
    expect(sortValue('issue', 'task', i, ctx)).toBe(dayIndex('2026-09-09'))
    expect(sortValue('issue', 'task', issue({ id: 'i3', taskId: 'zz' }), ctx)).toBe(0)
    expect(sortValue('issue', 'creator', i, ctx)).toBe('乙')
    expect(sortValue('issue', 'created', i, ctx)).toBe(dayIndex('2026-09-01'))
  })
})

describe('applySort', () => {
  it('applySort 空陣列', () => {
    expect(applySort([], [{ k: 'start', dir: 'asc' }], 'task', ctx)).toEqual([])
  })

  it('沒有排序鍵時原樣回傳', () => {
    const list = [task({ id: 'b' }), task({ id: 'a' })]
    expect(applySort(list, [], 'task', ctx).map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('多鍵排序：先優先度 desc，同分再 start asc', () => {
    const list = [
      task({ id: 'a', priority: 'mid', start: '2026-09-01' }),
      task({ id: 'b', priority: 'high', start: '2026-09-05' }),
      task({ id: 'c', priority: 'high', start: '2026-09-02' }),
    ]
    const sorts: SortKey[] = [
      { k: 'priority', dir: 'desc' },
      { k: 'start', dir: 'asc' },
    ]
    expect(applySort(list, sorts, 'task', ctx).map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('字串鍵用 localeCompare 比較且不改入參', () => {
    const list = [issue({ id: 'i1', creatorId: 'm2' }), issue({ id: 'i2', creatorId: 'm1' })]
    const out = applySort(list, [{ k: 'creator', dir: 'asc' }], 'issue', ctx)
    expect(out.map((i) => i.id)).toEqual(['i2', 'i1'])
    expect(list.map((i) => i.id)).toEqual(['i1', 'i2'])
  })
})

describe('bumpSort', () => {
  it('bumpSort 預設方向：start / due / created 為 asc，其餘 desc', () => {
    expect(bumpSort([], 'start')).toEqual([{ k: 'start', dir: 'asc' }])
    expect(bumpSort([], 'due')).toEqual([{ k: 'due', dir: 'asc' }])
    expect(bumpSort([], 'created')).toEqual([{ k: 'created', dir: 'asc' }])
    expect(bumpSort([], 'priority')).toEqual([{ k: 'priority', dir: 'desc' }])
  })

  it('bumpSort 已在清單裡就翻轉方向，且不改入參', () => {
    const cur: SortKey[] = [{ k: 'start', dir: 'asc' }]
    expect(bumpSort(cur, 'start')).toEqual([{ k: 'start', dir: 'desc' }])
    expect(bumpSort(bumpSort(cur, 'start'), 'start')).toEqual([{ k: 'start', dir: 'asc' }])
    expect(cur).toEqual([{ k: 'start', dir: 'asc' }])
  })

  it('bumpSort 依序 push 保留多鍵順序', () => {
    expect(bumpSort(bumpSort([], 'priority'), 'start')).toEqual([
      { k: 'priority', dir: 'desc' },
      { k: 'start', dir: 'asc' },
    ])
  })

  it('預設排序是時程 asc 與期限 asc', () => {
    expect(DEFAULT_TASK_SORT).toEqual([{ k: 'start', dir: 'asc' }])
    expect(DEFAULT_ISSUE_SORT).toEqual([{ k: 'due', dir: 'asc' }])
  })
})
