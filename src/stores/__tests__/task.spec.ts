import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 新實體的 id 是 UUID v4（spec 目標 4），只能斷言格式。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 固定時鐘：2026-09-18，與 e2e 的 clock helper 同一天。 */
const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('taskStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUiStore().now = NOW
    useTaskStore().load(structuredClone(sampleProject))
  })

  it('load 後 cascade 已套用且 visibleRows = 6 分類 + 30 任務', () => {
    const s = useTaskStore()
    expect(s.tasks).toHaveLength(30)
    expect(s.visibleRows).toHaveLength(36)
    // 每條相依的下游 start 都不早於上游 start（cascade 的不變式）
    for (const d of s.deps) {
      const from = s.taskById(d.from)!
      const to = s.taskById(d.to)!
      expect(dayIndex(to.start)).toBeGreaterThanOrEqual(dayIndex(from.start))
    }
  })

  it('taskById / groupById 走索引且查不到回 undefined', () => {
    const s = useTaskStore()
    expect(s.taskById('t3')?.name).toBe('前端框架建置')
    expect(s.groupById('g1')?.name).toBe('前端開發')
    expect(s.taskById('nope')).toBeUndefined()
  })

  it('range 與 rowIndexOf 反映目前可見列', () => {
    const s = useTaskStore()
    expect(s.range.b - s.range.a).toBeGreaterThan(0)
    expect(s.rowIndexOf.t1).toBe(1)
    expect(Object.keys(s.rowIndexOf)).toHaveLength(30)
  })

  it('addDep 拒絕循環回 false、成功回 true 並 cascade', () => {
    const s = useTaskStore()
    expect(s.addDep('t2', 't1')).toBe(false)
    expect(s.addDep('t1', 't2')).toBe(false)
    const before = s.deps.length
    expect(s.addDep('t1', 't5')).toBe(true)
    expect(s.deps).toHaveLength(before + 1)
    expect(dayIndex(s.taskById('t5')!.start)).toBeGreaterThanOrEqual(
      dayIndex(s.taskById('t1')!.start),
    )
  })

  it('removeDep 只刪那一條', () => {
    const s = useTaskStore()
    const before = s.deps.length
    s.removeDep('d1')
    expect(s.deps).toHaveLength(before - 1)
    expect(s.deps.find((d) => d.id === 'd1')).toBeUndefined()
  })

  it('predecessors / successors 回前置與後續任務', () => {
    const s = useTaskStore()
    expect(s.predecessors('t3').map((t) => t.id)).toEqual(['t2'])
    expect(s.successors('t3').map((t) => t.id)).toEqual(['t4'])
    expect(s.predecessors('t1').map((t) => t.id)).toEqual(['t28'])
  })

  it('addGroup 依現有數量命名並接在最後', () => {
    const s = useTaskStore()
    const g = s.addGroup()
    expect(g.name).toBe('新分類 7')
    expect(s.groups[s.groups.length - 1]!.id).toBe(g.id)
    expect(useUiStore().collapsedGroups.has(g.id)).toBe(false)
  })

  it('renameGroup / toggleGroup / setAllCollapsed / moveGroup', () => {
    const s = useTaskStore()
    const ui = useUiStore()
    s.renameGroup('g1', '前端')
    expect(s.groupById('g1')!.name).toBe('前端')
    s.toggleGroup('g1')
    // review C5：收合狀態在 ui，不在 Group 上
    expect(ui.collapsedGroups.has('g1')).toBe(true)
    expect(s.visibleRows).toHaveLength(36 - 6)
    s.toggleGroup('g1')
    expect(ui.collapsedGroups.has('g1')).toBe(false)
    s.setAllCollapsed(true)
    expect(ui.collapsedGroups.size).toBe(s.groups.length)
    expect(s.visibleRows).toHaveLength(6)
    s.setAllCollapsed(false)
    expect(ui.collapsedGroups.size).toBe(0)
    s.moveGroup('g1', 1)
    expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g2', 'g1'])
    s.moveGroup('g2', -1)
    expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g2', 'g1'])
  })

  // review C5：改名走的是 groups 陣列，收合狀態在 ui，兩者互不影響
  it('收合中的分類改名不會被展開', () => {
    const s = useTaskStore()
    s.toggleGroup('g1')
    s.renameGroup('g1', '改過的名字')
    expect(useUiStore().collapsedGroups.has('g1')).toBe(true)
  })

  it('removeGroup 連任務、issue、deps 一起刪並清 selection', () => {
    const s = useTaskStore()
    const issues = useIssueStore()
    const sel = useSelectionStore()
    sel.selectTask('t1')
    sel.groupId = 'g1'
    const gone = s.tasks.filter((t) => t.groupId === 'g1').map((t) => t.id)
    expect(gone.length).toBeGreaterThan(0)
    s.removeGroup('g1')
    expect(s.groupById('g1')).toBeUndefined()
    expect(s.tasks.some((t) => gone.includes(t.id))).toBe(false)
    expect(issues.issues.some((i) => gone.includes(i.taskId))).toBe(false)
    expect(s.deps.some((d) => gone.includes(d.from) || gone.includes(d.to))).toBe(false)
    expect(sel.taskId).toBeNull()
    expect(sel.groupId).toBeNull()
  })

  it('moveTaskTo 任務上方插前、下方插後、到分類末尾改 groupId', () => {
    const s = useTaskStore()
    s.moveTaskTo('t1', { kind: 't', id: 't3' })
    expect(s.tasks.map((t) => t.id).slice(0, 3)).toEqual(['t2', 't3', 't1'])
    s.moveTaskTo('t1', { kind: 't', id: 't2' })
    expect(s.tasks.map((t) => t.id).slice(0, 3)).toEqual(['t1', 't2', 't3'])
    s.moveTaskTo('t1', { kind: 'g', id: 'g2', dir: 'up' })
    expect(s.taskById('t1')!.groupId).toBe('g2')
    const g2 = s.tasks.filter((t) => t.groupId === 'g2').map((t) => t.id)
    expect(g2[g2.length - 1]).toBe('t1')
  })

  it('moveTaskTo 丟到自己身上時早退', () => {
    const s = useTaskStore()
    const order = s.tasks.map((t) => t.id)
    s.moveTaskTo('t1', { kind: 't', id: 't1' })
    expect(s.tasks.map((t) => t.id)).toEqual(order)
  })

  it('addTask 用今天起算五天並選取新任務', () => {
    const s = useTaskStore()
    const sel = useSelectionStore()
    sel.groupId = 'g3'
    const t = s.addTask()!
    expect(t.id).toMatch(UUID)
    expect(t.groupId).toBe('g3')
    expect(t.start).toBe('2026-09-18')
    expect(t.end).toBe('2026-09-22')
    expect(t.status).toBe('todo')
    expect(t.priority).toBe('mid')
    expect(sel.taskId).toBe(t.id)
  })

  it('addTask 無分類時改新增分類', () => {
    const s = useTaskStore()
    s.groups = []
    s.tasks = []
    expect(s.addTask()).toBeNull()
    expect(s.groups).toHaveLength(1)
    expect(s.tasks).toHaveLength(0)
  })

  it('updateTask 走 applyTaskPatch：改狀態填 done、移動連動下游', () => {
    const s = useTaskStore()
    s.updateTask('t1', { status: 'doing' })
    expect(s.taskById('t1')!.done).toBe('')
    s.updateTask('t1', { status: 'done' })
    expect(s.taskById('t1')!.done).toBe('2026-09-18')

    // t3 往後推 3 天，靠 d3（t3→t4）連動到 t4
    const t4Start = dayIndex(s.taskById('t4')!.start)
    const t3 = s.taskById('t3')!
    s.updateTask('t3', {
      start: isoFromIndex(dayIndex(t3.start) + 3),
      end: isoFromIndex(dayIndex(t3.end) + 3),
    })
    expect(dayIndex(s.taskById('t4')!.start)).toBe(t4Start + 3)
  })

  it('setTaskDoneDirect 只改 done、不走 cascade', () => {
    const s = useTaskStore()
    const t2 = s.taskById('t2')!.start
    s.setTaskDoneDirect('t1', '2026-09-30')
    expect(s.taskById('t1')!.done).toBe('2026-09-30')
    expect(s.taskById('t2')!.start).toBe(t2)
    s.setTaskDoneDirect('t1', '')
    expect(s.taskById('t1')!.done).toBe('')
  })

  it('assign 是聯集、不重複', () => {
    const s = useTaskStore()
    s.assign('t1', ['m3', 'm7'])
    expect(s.taskById('t1')!.assigneeIds).toEqual(['m3', 'm5', 'm7'])
    s.assign('t1', [])
    expect(s.taskById('t1')!.assigneeIds).toEqual(['m3', 'm5', 'm7'])
  })

  it('removeTask 清 ui.detail 與 selection.taskId', () => {
    const s = useTaskStore()
    const issues = useIssueStore()
    const sel = useSelectionStore()
    const ui = useUiStore()
    sel.selectTask('t3')
    ui.openDetail('t3', 'task')
    s.removeTask('t3')
    expect(s.taskById('t3')).toBeUndefined()
    expect(issues.issues.some((i) => i.taskId === 't3')).toBe(false)
    expect(s.deps.some((d) => d.from === 't3' || d.to === 't3')).toBe(false)
    expect(sel.taskId).toBeNull()
    expect(ui.detail).toBeNull()
  })
})
