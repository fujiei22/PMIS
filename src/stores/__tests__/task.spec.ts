import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

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
    // boot 負責 loadState 與 error sink，也把派生層的清理 watch 掛好（契約 E）
    await useProjectBoot().reload()
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

  // 載入失敗 / 重試的狀態機在啟動層（契約 E），見 useProjectBoot.spec
  it('load 失敗時 reject，本地資料不動', async () => {
    const s = useTaskStore()
    mockApi.failNext('loadProject')
    await expect(s.load()).rejects.toThrow()
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

  // review F4：摘要條 `sum-<gid>` 之類的假 id 不該建出指向不存在任務的相依
  it('addDep 對不存在的任務回 false', () => {
    const s = useTaskStore()
    const before = s.deps.length
    expect(s.addDep('sum-g2', 't1')).toBe(false)
    expect(s.addDep('t1', 'sum-g2')).toBe(false)
    expect(s.deps).toHaveLength(before)
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
      const touched = s.applyLocalPatch('t3', { start: isoFromIndex(dayIndex(t3) + 5) })
      s.moveTaskToLocal('t1', { kind: 'g', id: 'g2', dir: 'up' })
      s.moveGroupLocal('g1', 1)

      s.discardTaskDrag([...touched.map((t) => t.id), 't1'])
      s.discardGroupDrag()
      expect(s.tasks.map((t) => t.id)).toEqual(order)
      expect(s.taskById('t3')!.start).toBe(t3)
      expect(s.taskById('t1')!.groupId).toBe('g1')
      expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g1', 'g2'])
    })

    // review F2：dirty 集合守住「本地改了但還沒送出」的欄位
    it('改名還在飛時開始拖曳 → 回應到達不蓋掉拖曳中的日期', async () => {
      const s = useTaskStore()
      const t3 = s.taskById('t3')!
      const s0 = dayIndex(t3.start)
      const e0 = dayIndex(t3.end)
      mockApi.setLatency(5)
      // 改名 debounce 到期，送出；response 帶的是「舊日期 + 新名字」
      s.applyLocalPatch('t3', { name: '改名中' })
      const pending = s.commitTaskPatch('t3', { name: '改名中' })
      // 還在飛的時候開始拖曳：本地日期又動了，這一段還沒送
      s.applyLocalPatch('t3', { start: isoFromIndex(s0 + 4), end: isoFromIndex(e0 + 4) })
      await pending
      mockApi.setLatency(0)

      expect(s.taskById('t3')!.start).toBe(isoFromIndex(s0 + 4))
      expect(s.taskById('t3')!.end).toBe(isoFromIndex(e0 + 4))
      expect(s.taskById('t3')!.name).toBe('改名中')
    })

    it('拖曳取消不會清掉別筆還在 debounce 的改名', () => {
      const s = useTaskStore()
      s.applyLocalPatch('t5', { name: '打到一半' })
      const t3 = s.taskById('t3')!.start
      const touched = s.applyLocalPatch('t3', { start: isoFromIndex(dayIndex(t3) + 5) })

      s.discardTaskDrag(touched.map((t) => t.id))
      expect(s.taskById('t3')!.start).toBe(t3)
      expect(s.taskById('t5')!.name).toBe('打到一半')
    })

    it('別人推來的事件不蓋掉本地還沒送出的改名', () => {
      const s = useTaskStore()
      s.applyLocalPatch('t5', { name: '打到一半' })
      s.applyEvent({
        type: 'task.updated',
        payload: { ...s.taskById('t5')!, name: '別人改的' },
      })
      expect(s.taskById('t5')!.name).toBe('打到一半')
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

    // review F3：order 是送出當下的快照，之後才寫進 server 的實體不在裡面
    it('重排在飛時回來的 create 不會被重排成功踢出 server', async () => {
      const s = useTaskStore()
      let finishReorder: () => void = () => {}
      vi.spyOn(api, 'reorderTasks').mockImplementation(
        () => new Promise<void>((resolve) => (finishReorder = resolve)),
      )
      s.moveTaskToLocal('t1', { kind: 't', id: 't3' })
      const pending = s.commitTaskOrder()

      // 重排還在飛的時候，另一筆新任務建立成功並寫進 server
      const t = s.addTask({
        groupId: 'g1',
        assigneeIds: [],
        start: '2026-09-18',
        end: '2026-09-22',
      })!
      await new Promise((r) => setTimeout(r, 0))
      finishReorder()
      await pending

      // 整份對齊回 server（拖曳取消 / 下一次重排失敗）時它不該消失
      s.reconcileTasksFromServer()
      expect(s.taskById(t.id)).toBeDefined()
    })

    it('重排在飛時回來的 createGroup 不會被重排成功踢出 server', async () => {
      const s = useTaskStore()
      let finishReorder: () => void = () => {}
      vi.spyOn(api, 'reorderGroups').mockImplementation(
        () => new Promise<void>((resolve) => (finishReorder = resolve)),
      )
      s.moveGroupLocal('g1', 1)
      const pending = s.commitGroupOrder()

      const g = s.addGroup()
      await new Promise((r) => setTimeout(r, 0))
      finishReorder()
      await pending

      s.reconcileGroupsFromServer()
      expect(s.groupById(g.id)).toBeDefined()
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

    // review F1：還原的來源是 tracker.server，不是送出前的整份快照
    it('刪除失敗但 task.deleted 事件已經先到 → 本地不復活', async () => {
      const s = useTaskStore()
      mockApi.setLatency(5)
      mockApi.failNext('deleteTask', new ApiError('not_found', '找不到', 404))
      const pending = s.removeTask('t3')
      // 別的 client 早就刪掉了，事件比 404 先到
      s.applyEvent({ type: 'task.deleted', payload: { id: 't3' } })
      await pending
      mockApi.setLatency(0)

      expect(s.taskById('t3')).toBeUndefined()
      expect(useUiStore().errors[0]!.code).toBe('not_found')
    })

    it('刪除在飛時別筆的 task.updated 不被失敗還原蓋掉', async () => {
      const s = useTaskStore()
      mockApi.setLatency(5)
      mockApi.failNext('deleteTask')
      const pending = s.removeTask('t3')
      s.applyEvent({
        type: 'task.updated',
        payload: { ...s.taskById('t10')!, name: '別人改的' },
      })
      await pending
      mockApi.setLatency(0)

      expect(s.taskById('t3')).toBeDefined()
      expect(s.taskById('t10')!.name).toBe('別人改的')
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

    // review F5：cascade 的 updateTasks 不能跟 createDep 各走各的
    it('addDep 等 createDep 成功才送 cascade 的 updateTasks', async () => {
      const s = useTaskStore()
      let finish: () => void = () => {}
      vi.spyOn(api, 'createDep').mockImplementation(
        (d) => new Promise((resolve) => (finish = () => resolve(d))),
      )
      const many = vi.spyOn(api, 'updateTasks')
      // t24（10-08 起）推 t3（9-08 起）→ 一定有下游要送
      expect(s.addDep('t24', 't3')).toBe(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(many).not.toHaveBeenCalled()

      finish()
      await vi.waitFor(() => expect(many).toHaveBeenCalledTimes(1))
      expect(many.mock.calls[0]![0].map((t) => t.id)).toContain('t3')
    })

    it('createDep 失敗 → 相依與被它推動的下游一起還原，也不送 updateTasks', async () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      const before = { start: s.taskById('t3')!.start, end: s.taskById('t3')!.end }
      mockApi.failNext('createDep')
      expect(s.addDep('t24', 't3')).toBe(true)
      expect(s.taskById('t3')!.start).not.toBe(before.start)

      await vi.waitFor(() =>
        expect(s.deps.some((d) => d.from === 't24' && d.to === 't3')).toBe(false),
      )
      expect(s.taskById('t3')!.start).toBe(before.start)
      expect(s.taskById('t3')!.end).toBe(before.end)
      expect(many).not.toHaveBeenCalled()
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