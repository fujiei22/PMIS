import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi } from '@/api'
import { ApiError } from '@/api/types'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 新實體的 id 是 UUID v4（spec 目標 4），只能斷言格式。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 固定時鐘：2026-09-18，與 e2e 的 clock helper 同一天。 */
const NOW = Date.parse('2026-09-18T10:00:00Z')

describe('taskStore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    useClockStore().now = NOW
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await useTaskStore().load()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('load 直接採用 api 的資料、不跑 cascade（spec 目標 5）', () => {
    const s = useTaskStore()
    expect(s.tasks).toHaveLength(30)
    expect(s.groups).toHaveLength(6)
    expect(useUiStore().loadState).toBe('ready')
    // 日期逐筆等於 mocks 原值——載入不該改動任何一天
    for (const t of sampleProject.tasks) {
      const got = s.taskById(t.id)!
      expect([got.start, got.end]).toEqual([t.start, t.end])
    }
    // mocks 自身已滿足相依（consistency.spec 守衛）
    for (const d of s.deps) {
      const from = s.taskById(d.from)!
      const to = s.taskById(d.to)!
      expect(dayIndex(to.start)).toBeGreaterThanOrEqual(dayIndex(from.start))
    }
  })

  it('load 失敗時進 error 狀態，重試會成功', async () => {
    const s = useTaskStore()
    const ui = useUiStore()
    mockApi.failNext('loadProject')
    s.tasks = []
    await s.load()
    expect(ui.loadState).toBe('error')
    expect(ui.loadError).toBeTruthy()

    await s.load()
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(s.tasks).toHaveLength(30)
  })

  it('load 後保留已收合的分類（收合是畫面狀態，不隨資料重載）', async () => {
    const s = useTaskStore()
    const ui = useUiStore()
    ui.toggleGroup('g1')
    await s.load()
    expect(ui.collapsedGroups.has('g1')).toBe(true)
  })

  it('taskById / groupById 走索引且查不到回 undefined', () => {
    const s = useTaskStore()
    expect(s.taskById('t3')?.name).toBe('前端框架建置')
    expect(s.groupById('g1')?.name).toBe('前端開發')
    expect(s.taskById('nope')).toBeUndefined()
  })

  // visibleRows / rowIndexOf 已搬到派生層的 rows store（契約 E），見 rows.spec
  it('range 涵蓋所有任務', () => {
    const s = useTaskStore()
    expect(s.range.b - s.range.a).toBeGreaterThan(0)
  })

  it('addDep 拒絕循環回 false、成功回 true 並 cascade', async () => {
    const s = useTaskStore()
    expect(s.addDep('t2', 't1')).toBe(false)
    expect(s.addDep('t1', 't2')).toBe(false)
    const before = s.deps.length
    expect(s.addDep('t1', 't5')).toBe(true)
    expect(s.deps).toHaveLength(before + 1)
    expect(dayIndex(s.taskById('t5')!.start)).toBeGreaterThanOrEqual(
      dayIndex(s.taskById('t1')!.start),
    )
    await Promise.resolve()
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

  // 收合的 action 在 ui（契約 E：資料層不再轉呼叫派生層）
  it('renameGroup / moveGroup 與 ui 的收合互不影響', async () => {
    const s = useTaskStore()
    const ui = useUiStore()
    await s.renameGroup('g1', '前端')
    expect(s.groupById('g1')!.name).toBe('前端')
    ui.toggleGroup('g1')
    // review C5：收合狀態在 ui，不在 Group 上
    expect(ui.collapsedGroups.has('g1')).toBe(true)
    ui.toggleGroup('g1')
    expect(ui.collapsedGroups.has('g1')).toBe(false)
    ui.setAllCollapsed(s.groups.map((g) => g.id))
    expect(ui.collapsedGroups.size).toBe(s.groups.length)
    ui.setAllCollapsed([])
    expect(ui.collapsedGroups.size).toBe(0)
    await s.moveGroup('g1', 1)
    expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g2', 'g1'])
    await s.moveGroup('g2', -1)
    expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g2', 'g1'])
  })

  // review C5：改名走的是 groups 陣列，收合狀態在 ui，兩者互不影響
  it('收合中的分類改名不會被展開', async () => {
    const s = useTaskStore()
    useUiStore().toggleGroup('g1')
    await s.renameGroup('g1', '改過的名字')
    expect(useUiStore().collapsedGroups.has('g1')).toBe(true)
    expect(s.groupById('g1')!.name).toBe('改過的名字')
  })

  it('removeGroup 連任務、issue、deps 一起刪並清 selection', async () => {
    const s = useTaskStore()
    const issues = useIssueStore()
    const sel = useSelectionStore()
    sel.selectTask('t1')
    sel.groupId = 'g1'
    const gone = s.tasks.filter((t) => t.groupId === 'g1').map((t) => t.id)
    expect(gone.length).toBeGreaterThan(0)
    await s.removeGroup('g1')
    expect(s.groupById('g1')).toBeUndefined()
    expect(s.tasks.some((t) => gone.includes(t.id))).toBe(false)
    expect(issues.issues.some((i) => gone.includes(i.taskId))).toBe(false)
    expect(s.deps.some((d) => gone.includes(d.from) || gone.includes(d.to))).toBe(false)
    expect(sel.taskId).toBeNull()
    expect(sel.groupId).toBeNull()
  })

  it('moveTaskTo 任務上方插前、下方插後、到分類末尾改 groupId', async () => {
    const s = useTaskStore()
    await s.moveTaskTo('t1', { kind: 't', id: 't3' })
    expect(s.tasks.map((t) => t.id).slice(0, 3)).toEqual(['t2', 't3', 't1'])
    await s.moveTaskTo('t1', { kind: 't', id: 't2' })
    expect(s.tasks.map((t) => t.id).slice(0, 3)).toEqual(['t1', 't2', 't3'])
    await s.moveTaskTo('t1', { kind: 'g', id: 'g2', dir: 'up' })
    expect(s.taskById('t1')!.groupId).toBe('g2')
    const g2 = s.tasks.filter((t) => t.groupId === 'g2').map((t) => t.id)
    expect(g2[g2.length - 1]).toBe('t1')
  })

  it('moveTaskTo 丟到自己身上時早退', async () => {
    const s = useTaskStore()
    const order = s.tasks.map((t) => t.id)
    await s.moveTaskTo('t1', { kind: 't', id: 't1' })
    expect(s.tasks.map((t) => t.id)).toEqual(order)
  })

  // 預設值與建立後的選取在 useTaskActions（契約 E），見 useTaskActions.spec
  it('addTask 照參數建立，不自己算預設值也不動選取', () => {
    const s = useTaskStore()
    const sel = useSelectionStore()
    const t = s.addTask({
      groupId: 'g3',
      assigneeIds: ['m2'],
      start: '2026-10-01',
      end: '2026-10-05',
    })!
    expect(t.id).toMatch(UUID)
    expect(t.groupId).toBe('g3')
    expect(t.assigneeIds).toEqual(['m2'])
    expect(t.start).toBe('2026-10-01')
    expect(t.end).toBe('2026-10-05')
    expect(t.created).toBe('2026-09-18')
    expect(t.status).toBe('todo')
    expect(t.priority).toBe('mid')
    expect(s.tasks[s.tasks.length - 1]!.id).toBe(t.id)
    expect(sel.taskId).toBeNull()
  })

  it('addTask 的分類不存在時回 null', () => {
    const s = useTaskStore()
    const before = s.tasks.length
    expect(
      s.addTask({ groupId: 'nope', assigneeIds: [], start: '2026-10-01', end: '2026-10-05' }),
    ).toBeNull()
    expect(s.tasks).toHaveLength(before)
  })

  it('updateTask 走 applyTaskPatch：改狀態填 done、移動連動下游', async () => {
    const s = useTaskStore()
    await s.updateTask('t1', { status: 'doing' })
    expect(s.taskById('t1')!.done).toBe('')
    await s.updateTask('t1', { status: 'done' })
    expect(s.taskById('t1')!.done).toBe('2026-09-18')

    // t3 往後推 3 天，靠 d3（t3→t4）連動到 t4
    const t4Start = dayIndex(s.taskById('t4')!.start)
    const t3 = s.taskById('t3')!
    await s.updateTask('t3', {
      start: isoFromIndex(dayIndex(t3.start) + 3),
      end: isoFromIndex(dayIndex(t3.end) + 3),
    })
    expect(dayIndex(s.taskById('t4')!.start)).toBe(t4Start + 3)
  })

  it('setTaskDoneDirect 只改 done、不走 cascade', async () => {
    const s = useTaskStore()
    const t2 = s.taskById('t2')!.start
    await s.setTaskDoneDirect('t1', '2026-09-30')
    expect(s.taskById('t1')!.done).toBe('2026-09-30')
    expect(s.taskById('t2')!.start).toBe(t2)
    await s.setTaskDoneDirect('t1', '')
    expect(s.taskById('t1')!.done).toBe('')
  })

  it('assign 是聯集、不重複', async () => {
    const s = useTaskStore()
    await s.assign('t1', ['m3', 'm7'])
    expect(s.taskById('t1')!.assigneeIds).toEqual(['m3', 'm5', 'm7'])
    await s.assign('t1', [])
    expect(s.taskById('t1')!.assigneeIds).toEqual(['m3', 'm5', 'm7'])
  })

  it('removeTask 清 ui.detail 與 selection.taskId', async () => {
    const s = useTaskStore()
    const issues = useIssueStore()
    const sel = useSelectionStore()
    const ui = useUiStore()
    sel.selectTask('t3')
    ui.openDetail('t3', 'task')
    await s.removeTask('t3')
    expect(s.taskById('t3')).toBeUndefined()
    expect(issues.issues.some((i) => i.taskId === 't3')).toBe(false)
    expect(s.deps.some((d) => d.from === 't3' || d.to === 't3')).toBe(false)
    expect(sel.taskId).toBeNull()
    expect(ui.detail).toBeNull()
  })

  // ── 乐觀更新（契約 B）────────────────────────────────────────────────────
  describe('經 api 的乐觀更新', () => {
    it('單筆改名只送一次 api.updateTask', async () => {
      const s = useTaskStore()
      const one = vi.spyOn(api, 'updateTask')
      const many = vi.spyOn(api, 'updateTasks')
      await s.updateTask('t3', { name: '改過的名字' })
      expect(one).toHaveBeenCalledTimes(1)
      expect(one).toHaveBeenCalledWith('t3', { name: '改過的名字' })
      expect(many).not.toHaveBeenCalled()
      expect(s.taskById('t3')!.name).toBe('改過的名字')
    })

    it('有 cascade 時改送 api.updateTasks(changed)', async () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      const t3 = s.taskById('t3')!
      await s.updateTask('t3', {
        start: isoFromIndex(dayIndex(t3.start) + 3),
        end: isoFromIndex(dayIndex(t3.end) + 3),
      })
      expect(many).toHaveBeenCalledTimes(1)
      const sent = many.mock.calls[0]![0].map((t) => t.id)
      expect(sent).toContain('t3')
      expect(sent).toContain('t4')
    })

    it('拖曳：tick 只改本地，放開才送一次 updateTasks 並含下游', async () => {
      const s = useTaskStore()
      const one = vi.spyOn(api, 'updateTask')
      const many = vi.spyOn(api, 'updateTasks')
      const t3 = s.taskById('t3')!
      const s0 = dayIndex(t3.start)
      const e0 = dayIndex(t3.end)
      for (let k = 1; k <= 3; k++) {
        s.applyLocalPatch('t3', { start: isoFromIndex(s0 + k), end: isoFromIndex(e0 + k) })
      }
      expect(one).not.toHaveBeenCalled()
      expect(many).not.toHaveBeenCalled()

      const dirty = s.collectDirtyTasks()
      expect(dirty.map((t) => t.id)).toContain('t4')
      await s.commitTasks(dirty)
      expect(many).toHaveBeenCalledTimes(1)
      expect(s.taskById('t3')!.start).toBe(isoFromIndex(s0 + 3))
      expect(s.collectDirtyTasks()).toEqual([])
    })

    it('拖曳送出失敗 → 整段還原並推一筆錯誤', async () => {
      const s = useTaskStore()
      const ui = useUiStore()
      const t3 = s.taskById('t3')!
      const before = { start: t3.start, end: t3.end }
      const t4Before = s.taskById('t4')!.start
      mockApi.failNext('updateTasks')
      s.applyLocalPatch('t3', {
        start: isoFromIndex(dayIndex(t3.start) + 3),
        end: isoFromIndex(dayIndex(t3.end) + 3),
      })
      await s.commitTasks(s.collectDirtyTasks())

      expect(s.taskById('t3')!.start).toBe(before.start)
      expect(s.taskById('t3')!.end).toBe(before.end)
      expect(s.taskById('t4')!.start).toBe(t4Before)
      expect(ui.errors[0]!.label).toBe('更新任務')
    })

    it('拖曳取消 → reconcile 回 server 狀態（含順序）', () => {
      const s = useTaskStore()
      const order = s.tasks.map((t) => t.id)
      const t3 = s.taskById('t3')!.start
      s.applyLocalPatch('t3', { start: isoFromIndex(dayIndex(t3) + 5) })
      s.moveTaskToLocal('t1', { kind: 'g', id: 'g2', dir: 'up' })
      s.moveGroupLocal('g1', 1)

      s.reconcileTasksFromServer()
      s.reconcileGroupsFromServer()
      expect(s.tasks.map((t) => t.id)).toEqual(order)
      expect(s.taskById('t3')!.start).toBe(t3)
      expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g1', 'g2'])
    })

    it('列重排放開送一次 reorderTasks、分類重排送 reorderGroups', async () => {
      const s = useTaskStore()
      const reorderTasks = vi.spyOn(api, 'reorderTasks')
      const reorderGroups = vi.spyOn(api, 'reorderGroups')
      s.moveTaskToLocal('t1', { kind: 't', id: 't3' })
      await s.commitTaskOrder()
      expect(reorderTasks).toHaveBeenCalledTimes(1)
      expect(reorderTasks.mock.calls[0]![0]).toHaveLength(30)

      s.moveGroupLocal('g1', 1)
      await s.commitGroupOrder()
      expect(reorderGroups).toHaveBeenCalledTimes(1)
      expect(reorderGroups.mock.calls[0]![0].slice(0, 2)).toEqual(['g2', 'g1'])
    })

    it('列重排失敗 → 順序還原', async () => {
      const s = useTaskStore()
      const order = s.tasks.map((t) => t.id)
      mockApi.failNext('reorderTasks')
      s.moveTaskToLocal('t1', { kind: 't', id: 't3' })
      await s.commitTaskOrder()
      expect(s.tasks.map((t) => t.id)).toEqual(order)
    })

    it('新增任務失敗 → 本地那筆被收回', async () => {
      const s = useTaskStore()
      mockApi.failNext('createTask', new ApiError('conflict', '重複的 id', 409))
      const t = s.addTask({
        groupId: 'g1',
        assigneeIds: [],
        start: '2026-09-18',
        end: '2026-09-22',
      })!
      await vi.waitFor(() => expect(s.taskById(t.id)).toBeUndefined())
      expect(useUiStore().errors[0]!.label).toBe('新增任務')
      expect(useUiStore().errors[0]!.code).toBe('conflict')
    })

    it('刪除任務失敗 → 任務與它的 issue / 相依 / 留言一起回來', async () => {
      const s = useTaskStore()
      const issues = useIssueStore()
      const comments = useCommentStore()
      const beforeTasks = s.tasks.map((t) => t.id)
      const beforeIssues = issues.issues.map((i) => i.id)
      const beforeDeps = s.deps.map((d) => d.id)
      const beforeComments = comments.comments.map((c) => c.id)

      mockApi.failNext('deleteTask')
      await s.removeTask('t3')

      expect(s.tasks.map((t) => t.id)).toEqual(beforeTasks)
      expect(issues.issues.map((i) => i.id)).toEqual(beforeIssues)
      expect(s.deps.map((d) => d.id)).toEqual(beforeDeps)
      expect(comments.comments.map((c) => c.id)).toEqual(beforeComments)
      expect(useUiStore().errors[0]!.label).toBe('刪除任務')
    })

    it('刪除分類失敗 → 分類與底下的任務回來', async () => {
      const s = useTaskStore()
      const before = { groups: s.groups.map((g) => g.id), tasks: s.tasks.map((t) => t.id) }
      mockApi.failNext('deleteGroup')
      await s.removeGroup('g1')
      expect(s.groups.map((g) => g.id)).toEqual(before.groups)
      expect(s.tasks.map((t) => t.id)).toEqual(before.tasks)
    })

    it('建立相依失敗 → 相依被收回', async () => {
      const s = useTaskStore()
      const before = s.deps.length
      mockApi.failNext('createDep')
      s.addDep('t1', 't5')
      await vi.waitFor(() => expect(s.deps).toHaveLength(before))
    })
  })

  // ── 事件（契約 B）────────────────────────────────────────────────────────
  describe('applyEvent', () => {
    it('task.updated 直接套到本地', () => {
      const s = useTaskStore()
      const next = { ...s.taskById('t3')!, name: '別的 client 改的' }
      s.applyEvent({ type: 'task.updated', payload: next })
      expect(s.taskById('t3')!.name).toBe('別的 client 改的')
    })

    it('task.created / task.deleted', () => {
      const s = useTaskStore()
      const t = { ...s.taskById('t3')!, id: 'tX', name: '新來的' }
      s.applyEvent({ type: 'task.created', payload: t })
      expect(s.taskById('tX')!.name).toBe('新來的')
      s.applyEvent({ type: 'task.deleted', payload: { id: 'tX' } })
      expect(s.taskById('tX')).toBeUndefined()
    })

    it('group.updated / group.deleted / dep.created / dep.deleted', () => {
      const s = useTaskStore()
      s.applyEvent({ type: 'group.updated', payload: { id: 'g1', name: '改名了' } })
      expect(s.groupById('g1')!.name).toBe('改名了')
      s.applyEvent({ type: 'dep.created', payload: { id: 'dX', from: 't1', to: 't5' } })
      expect(s.deps.some((d) => d.id === 'dX')).toBe(true)
      s.applyEvent({ type: 'dep.deleted', payload: { id: 'dX' } })
      expect(s.deps.some((d) => d.id === 'dX')).toBe(false)
      s.applyEvent({ type: 'group.deleted', payload: { id: 'g6' } })
      expect(s.groupById('g6')).toBeUndefined()
    })

    it('自己還在飛的那筆不被事件蓋掉（in-flight 只寫 server）', async () => {
      const s = useTaskStore()
      mockApi.setLatency(5)
      const pending = s.updateTask('t3', { name: '我打的字' })
      s.applyEvent({
        type: 'task.updated',
        payload: { ...s.taskById('t3')!, name: '別人改的' },
      })
      expect(s.taskById('t3')!.name).toBe('我打的字')
      await pending
      mockApi.setLatency(0)
      // 回應是自己的值，飛完之後對齊到自己送出的那筆
      expect(s.taskById('t3')!.name).toBe('我打的字')
    })

    it('同值事件是 no-op', () => {
      const s = useTaskStore()
      const before = s.taskById('t3')!
      s.applyEvent({ type: 'task.updated', payload: { ...before } })
      expect(s.taskById('t3')!.name).toBe(before.name)
    })
  })
})
