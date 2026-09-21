import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ISSUE_SORT, DEFAULT_TASK_SORT } from '@/lib/sort'
import { sampleProject } from '@/mocks/sampleProject'
import { useFilterStore } from '@/stores/filter'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('filterStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUiStore().now = NOW
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('初始值為契約 D 列的預設', () => {
    const f = useFilterStore()
    expect(f.memberIds).toEqual([])
    expect(f.statuses).toEqual([])
    expect(f.priorities).toEqual([])
    expect(f.groupIds).toEqual([])
    expect(f.issueMode).toBe('all')
    expect(f.dateMode).toBe('off')
    expect(f.d1).toBe('')
    expect(f.d2).toBe('')
    expect(f.onlyFiltered).toBe(true)
    expect(f.issueLevels).toEqual([])
    expect(f.issueStatuses).toEqual([])
    expect(f.taskSort).toEqual(DEFAULT_TASK_SORT)
    expect(f.issueSort).toEqual(DEFAULT_ISSUE_SORT)
    expect(f.issueGroupBy).toBe('status')
    expect(f.calendarTarget).toBe('d1')
    expect(f.calendarMonth).toBeNull()
  })

  it('matchedIds 隨 statuses 變', () => {
    const f = useFilterStore()
    const tasks = useTaskStore()
    expect(f.matchedIds.size).toBe(30)
    f.statuses = ['done']
    const done = tasks.tasks.filter((t) => t.status === 'done')
    expect(f.matchedIds.size).toBe(done.length)
    expect(done.length).toBeGreaterThan(0)
    expect(f.matchedIds.has(done[0]!.id)).toBe(true)
    f.statuses = []
    expect(f.matchedIds.size).toBe(30)
  })

  it('passTask 受 onlyFiltered 影響而 matchTask 不受', () => {
    const f = useFilterStore()
    const tasks = useTaskStore()
    f.statuses = ['done']
    const miss = tasks.tasks.find((t) => t.status !== 'done')!
    expect(f.matchTask(miss)).toBe(false)
    expect(f.passTask(miss)).toBe(false)
    f.onlyFiltered = false
    expect(f.matchTask(miss)).toBe(false)
    expect(f.passTask(miss)).toBe(true)
  })

  it('anyTaskFilter 與 anyFilter 的差別在 Issue 專屬篩選', () => {
    const f = useFilterStore()
    expect(f.anyTaskFilter).toBe(false)
    expect(f.anyFilter).toBe(false)
    f.issueLevels = ['A']
    expect(f.anyTaskFilter).toBe(false)
    expect(f.anyFilter).toBe(true)
    f.issueLevels = []
    f.issueStatuses = ['delayed']
    expect(f.anyFilter).toBe(true)
    f.issueStatuses = []
    f.priorities = ['high']
    expect(f.anyTaskFilter).toBe(true)
    expect(f.anyFilter).toBe(true)
  })

  it('clear 把篩選欄位全部回初始值，但不動排序與 onlyFiltered', () => {
    const f = useFilterStore()
    f.memberIds = ['m1']
    f.statuses = ['todo']
    f.priorities = ['high']
    f.groupIds = ['g1']
    f.issueMode = 'has'
    f.dateMode = 'between'
    f.d1 = '2026-09-01'
    f.d2 = '2026-09-30'
    f.issueLevels = ['A']
    f.issueStatuses = ['open']
    f.calendarMonth = '2026-09'
    f.bumpTaskSort('days')
    f.onlyFiltered = false
    f.clear()
    expect(f.anyFilter).toBe(false)
    expect(f.memberIds).toEqual([])
    expect(f.d1).toBe('')
    expect(f.d2).toBe('')
    expect(f.issueMode).toBe('all')
    expect(f.dateMode).toBe('off')
    expect(f.calendarMonth).toBeNull()
    expect(f.taskSort).toHaveLength(2)
    expect(f.onlyFiltered).toBe(false)
  })

  it('bumpTaskSort / dropTaskSort / resetTaskSort 回預設', () => {
    const f = useFilterStore()
    f.bumpTaskSort('days')
    expect(f.taskSort).toEqual([
      { k: 'start', dir: 'asc' },
      { k: 'days', dir: 'desc' },
    ])
    f.bumpTaskSort('start')
    expect(f.taskSort[0]).toEqual({ k: 'start', dir: 'desc' })
    f.dropTaskSort('start')
    expect(f.taskSort).toEqual([{ k: 'days', dir: 'desc' }])
    f.resetTaskSort()
    expect(f.taskSort).toEqual(DEFAULT_TASK_SORT)
  })

  it('bumpIssueSort / dropIssueSort / resetIssueSort 回預設', () => {
    const f = useFilterStore()
    f.bumpIssueSort('priority')
    expect(f.issueSort).toEqual([
      { k: 'due', dir: 'asc' },
      { k: 'priority', dir: 'desc' },
    ])
    f.dropIssueSort('due')
    expect(f.issueSort).toEqual([{ k: 'priority', dir: 'desc' }])
    f.resetIssueSort()
    expect(f.issueSort).toEqual(DEFAULT_ISSUE_SORT)
  })

  it('resetTaskSort 不共用 DEFAULT 常數的陣列實體', () => {
    const f = useFilterStore()
    f.resetTaskSort()
    f.bumpTaskSort('days')
    expect(DEFAULT_TASK_SORT).toEqual([{ k: 'start', dir: 'asc' }])
  })

  // review m4：字樣原本在 GanttPanel 與 KanbanPanel 各抄一份，還各自重跑一次 matchTask。
  describe('taskCountLabel', () => {
    it('沒篩選時是「共 N 個任務」', () => {
      const f = useFilterStore()
      const tasks = useTaskStore()
      expect(f.taskCountLabel).toBe(`共 ${tasks.tasks.length} 個任務`)
    })

    it('有篩選時是「已篩選 N/M 個任務」，數字取自 matchedIds', () => {
      const f = useFilterStore()
      const tasks = useTaskStore()
      f.statuses = ['done']
      expect(f.matchedIds.size).toBeLessThan(tasks.tasks.length)
      expect(f.taskCountLabel).toBe(`已篩選 ${f.matchedIds.size}/${tasks.tasks.length} 個任務`)
    })

    it('篩選條件改動後字樣跟著變', () => {
      const f = useFilterStore()
      const tasks = useTaskStore()
      f.statuses = ['done']
      const filtered = f.taskCountLabel
      f.clear()
      expect(f.taskCountLabel).not.toBe(filtered)
      expect(f.taskCountLabel).toBe(`共 ${tasks.tasks.length} 個任務`)
    })

    it('不受「只顯示篩選結果」開關影響（legacy :3532 也只看 matchTask）', () => {
      const f = useFilterStore()
      f.statuses = ['done']
      const on = f.taskCountLabel
      f.onlyFiltered = false
      expect(f.taskCountLabel).toBe(on)
    })
  })
})
