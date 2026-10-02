import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/date'
import { createWorkdays, WEEKEND_ONLY } from '@/lib/workdays'
import { sampleCalendar } from '@/mocks/sampleCalendar'
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
  duration: 1,
  baselineStart: '',
  baselineEnd: '',
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
  { id: 'm1', name: '甲', role: '', color: '#000', active: true },
  { id: 'm2', name: '乙', role: '', color: '#000', active: true },
]
const tasks = [task({ id: 't1', start: '2026-09-01' }), task({ id: 't2', start: '2026-09-09' })]
const TODAY_IDX = dayIndex('2026-09-18')
const ctx: SortCtx = {
  taskById: (id) => tasks.find((t) => t.id === id),
  memberById: (id) => members.find((m) => m.id === id),
  openIssueCount: (id) => (id === 't1' ? 3 : 0),
  todayIdx: TODAY_IDX,
  workdays: createWorkdays(sampleCalendar),
}

describe('sortValue', () => {
  it('任務各鍵取到對的值', () => {
    const t = task({
      id: 't1',
      start: '2026-09-10',
      end: '2026-09-14',
      duration: 3,
      priority: 'high',
    })
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

// 工期排序依有效工期（工作天；規則見 docs/reference/scheduling.md〈有效工期〉），不是起訖的日曆天。
describe('days 鍵：有效工期', () => {
  it('未開始：輸入的工期，不看起訖', () => {
    const t = task({ id: 'x', start: '2026-09-21', end: '2026-09-30', duration: 4 })
    expect(sortValue('task', 'days', t, ctx)).toBe(4)
  })

  it('進行中逾期：起訖之間的工作天比輸入工期長時取前者', () => {
    // 09-08（二）～09-18（五）有 9 個工作天，輸入工期 7
    const t = task({
      id: 'x',
      status: 'doing',
      start: '2026-09-08',
      end: '2026-09-18',
      duration: 7,
    })
    expect(sortValue('task', 'days', t, ctx)).toBe(9)
  })

  it('已完成：實際的工作天（扣週末）', () => {
    // 09-02（三）～09-08（二）：日曆天 7，工作天 5
    const t = task({
      id: 'x',
      status: 'done',
      start: '2026-09-02',
      end: '2026-09-08',
      done: '2026-09-08',
    })
    expect(sortValue('task', 'days', t, ctx)).toBe(5)
  })

  it('用 ctx.workdays 扣假日：沒載假日表時只扣週末', () => {
    // 09-21～09-29：09-25 中秋、09-28 教師節放假 → 5 個工作天；只看週末是 7
    const t = task({
      id: 'x',
      status: 'done',
      start: '2026-09-21',
      end: '2026-09-29',
      done: '2026-09-29',
    })
    expect(sortValue('task', 'days', t, ctx)).toBe(5)
    expect(sortValue('task', 'days', t, { ...ctx, workdays: WEEKEND_ONLY })).toBe(7)
  })

  it('依工期由長到短排', () => {
    const list = [
      task({ id: 'a', duration: 2 }),
      task({ id: 'b', status: 'doing', start: '2026-09-08', end: '2026-09-18', duration: 7 }),
      task({ id: 'c', duration: 8 }),
    ]
    expect(applySort(list, [{ k: 'days', dir: 'desc' }], 'task', ctx).map((t) => t.id)).toEqual([
      'b',
      'c',
      'a',
    ])
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
    // zh-Hant 預設依筆畫排：乙（1 畫）在 甲（5 畫）之前
    const list = [issue({ id: 'i1', creatorId: 'm1' }), issue({ id: 'i2', creatorId: 'm2' })]
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

// review m5：createdIndex 的後備值原本直接呼叫 Date.now()，是 lib 純函式唯一的破口。
describe('created 的後備值由 SortCtx.todayIdx 決定', () => {
  it('created / start 都沒填的任務用 ctx.todayIdx', () => {
    const t = task({ id: 'x', created: '', start: '' })
    expect(sortValue('task', 'created', t, ctx)).toBe(TODAY_IDX)
  })

  it('created / due 都沒填的 Issue 用 ctx.todayIdx', () => {
    const i = issue({ id: 'x', created: '', due: '' })
    expect(sortValue('issue', 'created', i, ctx)).toBe(TODAY_IDX)
  })

  it('換一個 todayIdx 就換一個值，不看系統時鐘', () => {
    const other = dayIndex('2030-01-01')
    const t = task({ id: 'x', created: '', start: '' })
    expect(sortValue('task', 'created', t, { ...ctx, todayIdx: other })).toBe(other)
  })

  it('有填 created 時不受 todayIdx 影響', () => {
    const t = task({ id: 'x', created: '2026-09-01' })
    expect(sortValue('task', 'created', t, { ...ctx, todayIdx: dayIndex('2030-01-01') })).toBe(
      dayIndex('2026-09-01'),
    )
  })
})
