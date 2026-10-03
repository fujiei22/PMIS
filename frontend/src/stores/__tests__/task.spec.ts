import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSample, useSampleCalendar } from '@/__tests__/loadSample'
import { api, mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { LOCKED_POLICY } from '@/lib/editPolicy'
import { isLate } from '@/lib/schedule'
import { sampleProject } from '@/mocks/sampleProject'
import { useBudgetStore } from '@/stores/budget'
import { useClockStore } from '@/stores/clock'
import { useCommentStore } from '@/stores/comment'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useProjectStore } from '@/stores/project'
import { useSelectionStore } from '@/stores/selection'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import { useWorkCalendarStore } from '@/stores/workCalendar'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/** 新實體的 id 是 UUID v4（spec 目標 4），只能斷言格式。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 2026-10-01 10:00（台北）：進行中的 t4 已逾期，未開始的下游跟著順延（跨日漂移）。 */
const OCT_1 = Date.parse('2026-10-01T10:00:00+08:00')

/** mock 目前存的那一筆（server 狀態）。 */
async function serverTask(id: string) {
  return (await api.loadProject('pmis')).tasks.find((t) => t.id === id)
}

describe('taskStore', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // 固定在 2026-09-18；boot 負責 loadState 與 error sink、把派生層的清理 watch 掛好（契約 E），
    // 工作日曆跟專案一起載入
    await loadSample()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('載入後畫面是推算結果：2026-09-18 的推算等於範例存的值（spec 目標 5）', () => {
    const s = useTaskStore()
    expect(s.tasks).toHaveLength(30)
    expect(s.groups).toHaveLength(6)
    expect(useUiStore().loadState).toBe('ready')
    for (const t of sampleProject.tasks)
      expect([s.taskById(t.id)!.start, s.taskById(t.id)!.end]).toEqual([t.start, t.end])
  })

  // 載入失敗 / 重試的狀態機在啟動層（契約 E），見 useProjectBoot.spec
  it('load 失敗時 reject，本地資料不動', async () => {
    const s = useTaskStore()
    mockApi.failNext('loadProject')
    await expect(s.load('pmis')).rejects.toThrow()
    expect(s.tasks).toHaveLength(30)
  })

  it('好幾發 load 同時在飛、回來順序顛倒時，較舊的回應不蓋掉較新的', async () => {
    const s = useTaskStore()
    const older = structuredClone(sampleProject)
    older.tasks[0]!.name = '較舊的快照'
    const newer = structuredClone(sampleProject)
    newer.tasks[0]!.name = '較新的快照'
    let releaseOlder!: () => void
    vi.spyOn(api, 'loadProject')
      .mockImplementationOnce(() => new Promise((r) => (releaseOlder = () => r(older))))
      .mockImplementationOnce(() => Promise.resolve(newer))
    const first = s.load('pmis')
    await s.load('pmis')
    releaseOlder()
    await first
    expect(s.tasks[0]!.name).toBe('較新的快照')
  })

  it('load 還在飛時推來 project.reloaded 整包：晚回來的 load 不蓋掉它', async () => {
    const s = useTaskStore()
    const older = structuredClone(sampleProject)
    older.tasks[0]!.name = '較舊的快照'
    const pushed = structuredClone(sampleProject)
    pushed.tasks[0]!.name = '推來的整包'
    let releaseOlder!: () => void
    vi.spyOn(api, 'loadProject').mockImplementationOnce(
      () => new Promise((r) => (releaseOlder = () => r(older))),
    )
    const first = s.load('pmis')
    await s.load(pushed)
    releaseOlder()
    await first
    expect(s.tasks[0]!.name).toBe('推來的整包')
  })

  it('較早的一發先回來照樣套用（不只認最後一發）', async () => {
    const s = useTaskStore()
    const older = structuredClone(sampleProject)
    older.tasks[0]!.name = '較早的一發'
    let releaseNewer!: (e: unknown) => void
    vi.spyOn(api, 'loadProject')
      .mockImplementationOnce(() => Promise.resolve(older))
      .mockImplementationOnce(() => new Promise((_, reject) => (releaseNewer = reject)))
    const first = s.load('pmis')
    const second = s.load('pmis')
    await first
    expect(s.tasks[0]!.name).toBe('較早的一發')
    releaseNewer(new ApiError('network', 'x'))
    await expect(second).rejects.toThrow()
    expect(s.tasks[0]!.name).toBe('較早的一發')
  })

  it('load 後保留已收合的分類（收合是畫面狀態，不隨資料重載）', async () => {
    const s = useTaskStore()
    const ui = useUiStore()
    ui.toggleGroup('g1')
    await s.load('pmis')
    expect(ui.collapsedGroups.has('g1')).toBe(true)
  })

  it('load(id) 把專案 id 傳給 api，專案本身與 canEdit 進 project store', async () => {
    const s = useTaskStore()
    const spy = vi.spyOn(api, 'loadProject')
    await s.load('pmis')
    expect(spy).toHaveBeenCalledWith('pmis')
    expect(useProjectStore().meta).toEqual({ id: 'pmis', name: 'My Project', pmId: 'm5' })
    expect(useProjectStore().canEdit).toBe(true)
  })

  it('換了專案：上一個專案晚回來的 load 整個丟掉（同一個專案的較早一發才照樣套用）', async () => {
    const s = useTaskStore()
    const old = structuredClone(sampleProject)
    old.tasks[0]!.name = '上一個專案'
    let releaseOld!: () => void
    vi.spyOn(api, 'loadProject')
      .mockImplementationOnce(() => new Promise((r) => (releaseOld = () => r(old))))
      .mockImplementationOnce(() => new Promise(() => {}))
    const first = s.load('a')
    void s.load('b')
    releaseOld()
    await first
    expect(s.tasks[0]!.name).not.toBe('上一個專案')
  })

  it('reset 清空整個資料層：分類 / 任務 / 相依與 member / issue / comment / budget / project', () => {
    const s = useTaskStore()
    useCommentStore().draft = '打到一半'
    s.reset()
    expect(s.groups).toEqual([])
    expect(s.tasks).toEqual([])
    expect(s.deps).toEqual([])
    expect(useIssueStore().issues).toEqual([])
    expect(useCommentStore().comments).toEqual([])
    expect(useCommentStore().draft).toBe('')
    expect(useMemberStore().members).toEqual([])
    expect(useMemberStore().currentUserId).toBe('')
    expect(useBudgetStore().budget).toEqual({ total: 0, actual: 0 })
    expect(useProjectStore().meta).toEqual({ id: '', name: '', pmId: '' })
    expect(useProjectStore().canEdit).toBe(false)
  })

  it('reset 讓還在飛的 load 作廢：晚回來也不把上一個專案灌回來', async () => {
    const s = useTaskStore()
    let release!: () => void
    vi.spyOn(api, 'loadProject').mockImplementationOnce(
      () => new Promise((r) => (release = () => r(structuredClone(sampleProject)))),
    )
    const pending = s.load('pmis')
    s.reset()
    release()
    await pending
    expect(s.tasks).toEqual([])
  })

  it('reset 之後，上一個專案還在飛的寫入回來不會被插回清單；失敗照樣報錯', async () => {
    const s = useTaskStore()
    const ui = useUiStore()
    let finishCreate!: (t: unknown) => void
    vi.spyOn(api, 'createTask').mockImplementationOnce(
      () => new Promise((r) => (finishCreate = r as (t: unknown) => void)),
    )
    let failGroup!: (e: unknown) => void
    vi.spyOn(api, 'createGroup').mockImplementationOnce(
      () => new Promise((_, reject) => (failGroup = reject)),
    )
    const t = s.addTask({ groupId: 'g1', assigneeIds: [], start: '2026-09-18', duration: 5 })!
    s.addGroup()
    s.reset()

    finishCreate(structuredClone({ ...t }))
    failGroup(new ApiError('network', 'x'))
    await new Promise((r) => setTimeout(r, 0))
    expect(s.tasks).toEqual([])
    expect(s.groups).toEqual([])
    // 那次修改真的沒存到：錯誤條照樣要讓人知道
    expect(ui.errors.map((e) => e.label)).toContain('新增分類')
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

  it('addDep 拒絕循環與重複回 false；成功回 true，畫面立刻照新相依重排', async () => {
    const s = useTaskStore()
    expect(s.addDep('t2', 't1')).toBe(false)
    expect(s.addDep('t1', 't2')).toBe(false)
    const before = s.deps.length
    // t30（11/10 結束）→ t26：t26 從 11/11 開始，t27 跟著推
    expect(s.addDep('t30', 't26')).toBe(true)
    expect(s.deps).toHaveLength(before + 1)
    expect(s.taskById('t26')!.start).toBe('2026-11-11')
    expect(dayIndex(s.taskById('t27')!.start)).toBeGreaterThan(dayIndex(s.taskById('t26')!.end))
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

  it('addGroup 依現有數量命名並接在最後，送出時帶目前專案的 id', () => {
    const s = useTaskStore()
    const createGroup = vi.spyOn(api, 'createGroup')
    const g = s.addGroup()!
    expect(g.name).toBe('新分類 7')
    expect(s.groups[s.groups.length - 1]!.id).toBe(g.id)
    expect(useUiStore().collapsedGroups.has(g.id)).toBe(false)
    expect(createGroup).toHaveBeenCalledWith('pmis', g)
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
  it('addTask 照參數建立（起訖依工期推算），不自己算預設值也不動選取', () => {
    const s = useTaskStore()
    const sel = useSelectionStore()
    const t = s.addTask({
      groupId: 'g3',
      assigneeIds: ['m2'],
      start: '2026-10-01',
      duration: 3,
    })!
    expect(t.id).toMatch(UUID)
    expect(t.groupId).toBe('g3')
    expect(t.assigneeIds).toEqual(['m2'])
    // 3 個工作天：10/01（四）、10/02（五）、10/05（一）
    expect(t.start).toBe('2026-10-01')
    expect(t.end).toBe('2026-10-05')
    expect(t.duration).toBe(3)
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
      s.addTask({ groupId: 'nope', assigneeIds: [], start: '2026-10-01', duration: 3 }),
    ).toBeNull()
    expect(s.tasks).toHaveLength(before)
  })

  it('updateTask：改狀態填 done；移動根任務推動下游', async () => {
    const s = useTaskStore()
    await s.updateTask('t1', { status: 'doing' })
    expect(s.taskById('t1')!.done).toBe('')
    await s.updateTask('t1', { status: 'done' })
    expect(s.taskById('t1')!.done).toBe('2026-09-18')

    // t24（未開始的根任務，10/08 起、工期 6）往後 3 天 → 10/11 週日順延到 10/12、結束 10/19；
    // 靠 d20（t24→t25）連動到 t25
    await s.updateTask('t24', { start: '2026-10-11' })
    expect([s.taskById('t24')!.start, s.taskById('t24')!.end]).toEqual(['2026-10-12', '2026-10-19'])
    expect(s.taskById('t25')!.start).toBe('2026-10-20')
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

  // ── 樂觀更新（契約 B）────────────────────────────────────────────────────
  describe('經 api 的樂觀更新', () => {
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

    it('牽動排程的欄位改送整批 api.updateTasks（含被推動的下游）', async () => {
      const s = useTaskStore()
      const one = vi.spyOn(api, 'updateTask')
      const many = vi.spyOn(api, 'updateTasks')
      await s.updateTask('t24', { start: '2026-10-11' })
      expect(one).not.toHaveBeenCalled()
      expect(many).toHaveBeenCalledTimes(1)
      const sent = many.mock.calls[0]![0].map((t) => t.id)
      expect(sent).toContain('t24')
      expect(sent).toContain('t25')
    })

    it('拖曳：tick 只改本地，放開才用 commitSchedule 送一次並含下游', async () => {
      const s = useTaskStore()
      const one = vi.spyOn(api, 'updateTask')
      const many = vi.spyOn(api, 'updateTasks')
      const s0 = dayIndex(s.taskById('t24')!.start)
      const touched = new Set(['t24'])
      for (let k = 1; k <= 3; k++) {
        for (const t of s.applyLocalPatch('t24', { start: isoFromIndex(s0 + k) })) touched.add(t.id)
      }
      expect(one).not.toHaveBeenCalled()
      expect(many).not.toHaveBeenCalled()
      expect(touched.has('t25')).toBe(true)

      await s.commitSchedule(touched)
      expect(many).toHaveBeenCalledTimes(1)
      expect(s.taskById('t24')!.start).toBe('2026-10-12')
      // 送出之後不再 dirty：別人推來的改名直接套上
      s.applyEvent({
        type: 'task.updated',
        payload: { ...(await serverTask('t24'))!, name: '別人改的' },
      })
      expect(s.taskById('t24')!.name).toBe('別人改的')
    })

    it('拖曳送出失敗 → 整段還原並推一筆錯誤', async () => {
      const s = useTaskStore()
      const ui = useUiStore()
      const before = { start: s.taskById('t24')!.start, end: s.taskById('t24')!.end }
      const t25Before = s.taskById('t25')!.start
      mockApi.failNext('updateTasks')
      s.applyLocalPatch('t24', { start: '2026-10-11' })
      await s.commitSchedule(['t24'])

      expect(s.taskById('t24')!.start).toBe(before.start)
      expect(s.taskById('t24')!.end).toBe(before.end)
      expect(s.taskById('t25')!.start).toBe(t25Before)
      expect(ui.errors[0]!.label).toBe('更新任務')
    })

    it('拖曳取消 → reconcile 回 server 狀態（含順序）', () => {
      const s = useTaskStore()
      const order = s.tasks.map((t) => t.id)
      const t24 = s.taskById('t24')!.start
      const touched = s.applyLocalPatch('t24', { start: isoFromIndex(dayIndex(t24) + 5) })
      s.moveTaskToLocal('t1', { kind: 'g', id: 'g2', dir: 'up' })
      s.moveGroupLocal('g1', 1)

      s.discardTaskDrag(['t24', ...touched.map((t) => t.id), 't1'])
      s.discardGroupDrag()
      expect(s.tasks.map((t) => t.id)).toEqual(order)
      expect(s.taskById('t24')!.start).toBe(t24)
      expect(s.taskById('t1')!.groupId).toBe('g1')
      expect(s.groups.map((g) => g.id).slice(0, 2)).toEqual(['g1', 'g2'])
    })

    // review F2：dirty 集合守住「本地改了但還沒送出」的欄位
    it('改名還在飛時開始拖曳 → 回應到達不蓋掉拖曳中的日期', async () => {
      const s = useTaskStore()
      mockApi.setLatency(5)
      // 改名 debounce 到期，送出；response 帶的是「舊日期 + 新名字」
      s.applyLocalPatch('t24', { name: '改名中' })
      const pending = s.commitTaskPatch('t24', { name: '改名中' })
      // 還在飛的時候開始拖曳：本地日期又動了，這一段還沒送
      s.applyLocalPatch('t24', { start: '2026-10-12' })
      await pending
      mockApi.setLatency(0)

      expect(s.taskById('t24')!.start).toBe('2026-10-12')
      expect(s.taskById('t24')!.end).toBe('2026-10-19')
      expect(s.taskById('t24')!.name).toBe('改名中')
    })

    it('拖曳取消不會清掉別筆還在 debounce 的改名', () => {
      const s = useTaskStore()
      s.applyLocalPatch('t5', { name: '打到一半' })
      const t24 = s.taskById('t24')!.start
      const touched = s.applyLocalPatch('t24', { start: isoFromIndex(dayIndex(t24) + 5) })

      s.discardTaskDrag(['t24', ...touched.map((t) => t.id)])
      expect(s.taskById('t24')!.start).toBe(t24)
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

    it('列重排放開送一次 reorderTasks、分類重排送 reorderGroups（都帶目前專案的 id）', async () => {
      const s = useTaskStore()
      const reorderTasks = vi.spyOn(api, 'reorderTasks')
      const reorderGroups = vi.spyOn(api, 'reorderGroups')
      s.moveTaskToLocal('t1', { kind: 't', id: 't3' })
      await s.commitTaskOrder()
      expect(reorderTasks).toHaveBeenCalledTimes(1)
      expect(reorderTasks.mock.calls[0]![0]).toBe('pmis')
      expect(reorderTasks.mock.calls[0]![1]).toHaveLength(30)

      s.moveGroupLocal('g1', 1)
      await s.commitGroupOrder()
      expect(reorderGroups).toHaveBeenCalledTimes(1)
      expect(reorderGroups.mock.calls[0]![0]).toBe('pmis')
      expect(reorderGroups.mock.calls[0]![1].slice(0, 2)).toEqual(['g2', 'g1'])
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
        duration: 5,
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

      const g = s.addGroup()!
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
        duration: 5,
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

    // review F5：寫回推動結果的 updateTasks 不能跟 createDep 各走各的
    it('addDep 等 createDep 成功才寫回被推動的下游', async () => {
      const s = useTaskStore()
      let finish: () => void = () => {}
      vi.spyOn(api, 'createDep').mockImplementation(
        (d) => new Promise((resolve) => (finish = () => resolve(d))),
      )
      const many = vi.spyOn(api, 'updateTasks')
      // t30（11/10 結束）推 t26（10/28 起）→ t26、t27 都要寫回
      expect(s.addDep('t30', 't26')).toBe(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(many).not.toHaveBeenCalled()

      finish()
      await vi.waitFor(() => expect(many).toHaveBeenCalledTimes(1))
      expect(many.mock.calls[0]![0].map((t) => t.id)).toEqual(
        expect.arrayContaining(['t26', 't27']),
      )
    })

    it('createDep 失敗 → 相依被收回、畫面照原本的相依排回去，也不送 updateTasks', async () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      const before = { start: s.taskById('t26')!.start, end: s.taskById('t26')!.end }
      mockApi.failNext('createDep')
      expect(s.addDep('t30', 't26')).toBe(true)
      expect(s.taskById('t26')!.start).not.toBe(before.start)

      await vi.waitFor(() =>
        expect(s.deps.some((d) => d.from === 't30' && d.to === 't26')).toBe(false),
      )
      expect(s.taskById('t26')!.start).toBe(before.start)
      expect(s.taskById('t26')!.end).toBe(before.end)
      expect(many).not.toHaveBeenCalled()
    })
  })

  // ── 前推排程（規則見 docs/reference/scheduling.md）────────────────────────
  describe('前推排程', () => {
    it('跨日：未開始的任務自動順延，不寫回', () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      useClockStore().now = OCT_1
      // t4（進行中，基準結束 09-24）到 10/01 已逾期 → 結束日推到 10/01 → t5 從下一個工作天 10/02 開始
      expect(s.taskById('t4')!.end).toBe('2026-10-01')
      expect(s.taskById('t5')!.start).toBe('2026-10-02')
      expect(many).not.toHaveBeenCalled()
    })

    it('改工期：結束日照工作天推算，下游跟著排，一次寫回', async () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      await s.updateTask('t5', { duration: 8 })
      expect(s.taskById('t5')!.end).toBe('2026-10-08')
      expect(s.taskById('t6')!.start).toBe('2026-10-12') // 10/09、10/10、10/11 放假
      expect(many.mock.calls[0]![0].map((t) => t.id)).toEqual(expect.arrayContaining(['t5', 't6']))
    })

    it('改成進行中：開始日記成今天', async () => {
      await useTaskStore().updateTask('t5', { status: 'doing' })
      expect(useTaskStore().taskById('t5')!.start).toBe('2026-09-18')
    })

    it('新增任務（開始日遇週末順延）：計畫＝建立時的推算起訖', () => {
      const s = useTaskStore()
      const t = s.addTask({ groupId: 'g1', assigneeIds: [], start: '2026-09-19', duration: 5 })!
      const got = s.taskById(t.id)!
      // 9/19 是週六 → 從 9/21 開始；5 個工作天＝9/21、22、23、24、29（9/25 中秋、9/26-27 週末、9/28 教師節）
      expect([got.start, got.end]).toEqual(['2026-09-21', '2026-09-29'])
      expect([got.baselineStart, got.baselineEnd]).toEqual([got.start, got.end])
    })

    it('刪相依：後續任務變成根任務，保留刪除當下推算的開始日', async () => {
      const s = useTaskStore()
      useClockStore().now = OCT_1
      const dep = s.deps.find((d) => d.from === 't4' && d.to === 't5')!
      await s.removeDep(dep.id)
      // 沒有記下來的話會變成 10/01（根任務、不早於今天）；記下來的是刪除前的 10/02
      expect(s.taskById('t5')!.start).toBe('2026-10-02')
      // 寫回之後不再 dirty：別人推來的改名直接套上
      s.applyEvent({
        type: 'task.updated',
        payload: { ...(await serverTask('t5'))!, name: '別人改的' },
      })
      expect(s.taskById('t5')!.name).toBe('別人改的')
    })

    it('刪相依失敗：記下的開始日放棄，存的值對齊回 server、不再 dirty', async () => {
      const s = useTaskStore()
      useClockStore().now = OCT_1
      const dep = s.deps.find((d) => d.from === 't4' && d.to === 't5')!
      mockApi.failNext('deleteDep')
      await s.removeDep(dep.id)
      expect(s.deps.some((d) => d.id === dep.id)).toBe(true)
      expect(s.inputs.find((t) => t.id === 't5')).toEqual(await serverTask('t5'))
      s.applyEvent({
        type: 'task.updated',
        payload: { ...(await serverTask('t5'))!, name: '別人改的' },
      })
      expect(s.taskById('t5')!.name).toBe('別人改的')
    })

    it('刪任務失敗：後續任務對齊回 server、不再 dirty', async () => {
      const s = useTaskStore()
      mockApi.failNext('deleteTask')
      await s.removeTask('t24')
      expect(s.taskById('t24')).toBeDefined()
      expect(s.inputs.find((t) => t.id === 't25')).toEqual(await serverTask('t25'))
      s.applyEvent({
        type: 'task.updated',
        payload: { ...(await serverTask('t25'))!, name: '別人改的' },
      })
      expect(s.taskById('t25')!.name).toBe('別人改的')
    })

    it('刪任務成功：後續任務保留開始日並寫回', async () => {
      const s = useTaskStore()
      await s.removeTask('t24')
      expect(s.taskById('t25')!.start).toBe('2026-10-19')
      expect((await serverTask('t25'))!.start).toBe('2026-10-19')
    })

    it('setTaskDoneDirect：改完成日會推動未開始的下游', async () => {
      const s = useTaskStore()
      await s.updateTask('t4', { status: 'done' }) // t4 完成於 09-18 → t5 從 09-21 開始
      expect(s.taskById('t5')!.start).toBe('2026-09-21')
      await s.setTaskDoneDirect('t4', '2026-09-22')
      expect(s.taskById('t5')!.start).toBe('2026-09-23')
    })

    it('有前置的未開始任務改開始日不生效、不留 dirty；之後的事件照樣套上', async () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      await s.updateTask('t5', { start: '2026-12-01' })
      expect(many).not.toHaveBeenCalled()
      expect(s.inputs.find((t) => t.id === 't5')).toEqual(await serverTask('t5'))
      s.applyEvent({
        type: 'task.updated',
        payload: { ...(await serverTask('t5'))!, name: '改名' },
      })
      expect(s.taskById('t5')!.name).toBe('改名')
    })

    it('根任務拖到今天以前：推算開始日順延到今天，放開後寫回推算值、不留 dirty', async () => {
      const s = useTaskStore()
      s.applyLocalPatch('t24', { start: '2026-09-10' })
      expect(s.taskById('t24')!.start).toBe('2026-09-18')
      await s.commitSchedule(['t24'])
      expect((await serverTask('t24'))!.start).toBe('2026-09-18')
      s.applyEvent({
        type: 'task.updated',
        payload: { ...(await serverTask('t24'))!, name: '改名' },
      })
      expect(s.taskById('t24')!.name).toBe('改名')
    })

    // review：拖曳中（被拖的那一筆還是 dirty）別處觸發的寫回，不送被它推動的下游的暫時位置
    it('拖曳中別處觸發寫回：被拖條的下游不跟著送', async () => {
      const s = useTaskStore()
      const many = vi.spyOn(api, 'updateTasks')
      s.applyLocalPatch('t24', { start: '2026-10-12' })
      expect(s.taskById('t25')!.start).toBe('2026-10-20')
      await s.commitSchedule([])
      const sent = many.mock.calls.flatMap((c) => c[0].map((t) => t.id))
      expect(sent).not.toContain('t24')
      expect(sent).not.toContain('t25')
    })

    it('刪分類：分類外失去所有前置的後續任務，保留刪除當下推算的開始日', async () => {
      const s = useTaskStore()
      // t30（g6，11/10 結束）→ t24（g5 的根任務）：t24 改從 11/11 開始
      expect(s.addDep('t30', 't24')).toBe(true)
      await vi.waitFor(async () => expect((await serverTask('t24'))!.start).toBe('2026-11-11'))
      // 刪 g6：t24 失去唯一的前置，變成根任務；沒記下來的話會退回存的 10/08
      await s.removeGroup('g6')
      expect(s.taskById('t24')!.start).toBe('2026-11-11')
      expect((await serverTask('t24'))!.start).toBe('2026-11-11')
    })

    // user 決定：日曆載入失敗時排程只扣週末，算出來的日期是錯的；推算漂移不寫回，只送這次改的任務
    it('日曆不是 ready：寫回只送這次改的任務，被推動的下游與跨日漂移等日曆恢復再送', async () => {
      const s = useTaskStore()
      const cal = useWorkCalendarStore()
      cal.data = null
      cal.status = 'error'
      useClockStore().now = OCT_1
      const many = vi.spyOn(api, 'updateTasks')
      const one = vi.spyOn(api, 'updateTask')
      // 改名：只送單筆 patch，不帶漂移
      await s.updateTask('t5', { name: '改名' })
      expect(one).toHaveBeenCalledTimes(1)
      expect(many).not.toHaveBeenCalled()
      // 改工期：只送 t24，不送被推動的 t25 與其他漂移的任務
      await s.updateTask('t24', { duration: 7 })
      expect(many.mock.calls.map((c) => c[0].map((t) => t.id))).toEqual([['t24']])

      // 日曆恢復：下一次寫回把漂移一起送
      useSampleCalendar()
      many.mockClear()
      await s.updateTask('t24', { duration: 6 })
      const sent = many.mock.calls.flatMap((c) => c[0].map((t) => t.id))
      expect(sent).toEqual(expect.arrayContaining(['t24', 't4', 't5']))
    })

    it('建立還在飛時改了工期：create 回來後補送一次', async () => {
      const s = useTaskStore()
      mockApi.setLatency(50)
      const t = s.addTask({ groupId: 'g1', assigneeIds: [], start: '2026-10-01', duration: 5 })!
      await s.updateTask(t.id, { duration: 3 })
      expect(s.taskById(t.id)!.end).toBe('2026-10-05')
      await vi.waitFor(async () => expect((await serverTask(t.id))?.duration).toBe(3), {
        timeout: 1000,
      })
      mockApi.setLatency(0)
    })

    it('identity：跨日漂移中的任務，改別筆時保持同一個物件', async () => {
      const s = useTaskStore()
      useClockStore().now = OCT_1
      const before = s.taskById('t20')!
      expect(before.start).not.toBe(sampleProject.tasks.find((t) => t.id === 't20')!.start)
      s.applyLocalPatch('t3', { name: '改名' })
      expect(s.taskById('t20')).toBe(before)
    })

    it('事件重排：推來的 task.updated 改了工期，下游跟著排', () => {
      const s = useTaskStore()
      const t5 = s.taskById('t5')!.start
      s.applyEvent({
        type: 'task.updated',
        payload: { ...s.inputs.find((t) => t.id === 't4')!, duration: 12 },
      })
      expect(dayIndex(s.taskById('t5')!.start)).toBeGreaterThan(dayIndex(t5))
    })

    it('日曆晚到：先載資料、後設日曆，畫面跟著重排', () => {
      const s = useTaskStore()
      useWorkCalendarStore().data = null
      // 沒有日曆時只看週末：t5 的工期把 9/25 中秋、9/28 教師節算成工作天，結束日提早
      expect(s.taskById('t5')!.end).not.toBe('2026-10-07')
      useSampleCalendar()
      expect(s.taskById('t5')!.end).toBe('2026-10-07')
    })
  })

  // ── 計畫（規則見 docs/reference/scheduling.md〈計畫與延遲〉）──────────────────
  // 計畫只看 PM 輸入的東西（根任務的計畫開始日、工期、相依）：PM 改了就是新計畫，現實造成的落後才算延遲
  describe('計畫', () => {
    it('09-18 延遲的是 t13；t3 逾期但比計畫早開工，推算結束日沒晚於計畫，不算延遲', () => {
      const s = useTaskStore()
      expect(s.tasks.filter((t) => isLate(t)).map((t) => t.id)).toEqual(['t13'])
      const t3 = s.taskById('t3')!
      expect([t3.end, t3.baselineEnd]).toEqual(['2026-09-18', '2026-09-29'])
    })

    it('時間到了沒做完就延遲：09-19 起 t8 也延遲', () => {
      useClockStore().now = Date.parse('2026-09-19T10:00:00+08:00')
      const late = useTaskStore().tasks.filter((t) => isLate(t))
      expect(late.map((t) => t.id)).toEqual(['t8', 't13'])
    })

    it('PM 改工期：自己與被推動的下游計畫一起改、不算延遲；計畫跟著推算結果寫回', async () => {
      const s = useTaskStore()
      const before = s.taskById('t5')!.baselineEnd
      const many = vi.spyOn(api, 'updateTasks')
      await s.updateTask('t4', { duration: 12 })
      const t5 = s.taskById('t5')!
      expect(t5.baselineEnd > before).toBe(true)
      expect(s.tasks.filter((t) => isLate(t)).map((t) => t.id)).toEqual(['t13'])
      const sent = many.mock.calls[0]![0].find((t) => t.id === 't5')!
      expect([sent.baselineStart, sent.baselineEnd]).toEqual([t5.baselineStart, t5.baselineEnd])
    })

    it('PM 把延遲任務的工期拉長：計畫跟著延長，延遲消失（PM 說了算）', async () => {
      const s = useTaskStore()
      await s.updateTask('t13', { duration: 9 })
      expect(s.tasks.filter((t) => isLate(t))).toHaveLength(0)
      expect((await serverTask('t13'))!.baselineEnd).toBe('2026-09-18')
    })

    it('未開始根任務改開始日：計畫開始日跟著改，不算延遲', async () => {
      const s = useTaskStore()
      await s.updateTask('t24', { start: '2026-10-12' })
      expect(s.inputs.find((t) => t.id === 't24')!.baselineStart).toBe('2026-10-12')
      expect(s.taskById('t24')!.baselineStart).toBe('2026-10-12')
      expect(isLate(s.taskById('t24')!)).toBe(false)
    })

    it('根任務晚開工算延遲：開工後開始日記成實際開工日，計畫開始日不變', async () => {
      const s = useTaskStore()
      // t24 計畫 10/08 開工，10/14 還沒開始：推算開始日推到今天，晚於計畫
      useClockStore().now = Date.parse('2026-10-14T10:00:00+08:00')
      expect(isLate(s.taskById('t24')!)).toBe(true)
      await s.updateTask('t24', { status: 'doing' })
      const t24 = s.inputs.find((t) => t.id === 't24')!
      expect([t24.start, t24.baselineStart]).toEqual(['2026-10-14', '2026-10-08'])
      expect(isLate(s.taskById('t24')!)).toBe(true)
    })

    it('刪相依讓未開始的任務變成根任務：計畫開始日釘在刪除當下的計畫，計畫不跳', async () => {
      const s = useTaskStore()
      const before = s.taskById('t5')!
      const dep = s.deps.find((d) => d.from === 't4' && d.to === 't5')!
      await s.removeDep(dep.id)
      const after = s.taskById('t5')!
      expect([after.baselineStart, after.baselineEnd]).toEqual([
        before.baselineStart,
        before.baselineEnd,
      ])
      expect((await serverTask('t5'))!.baselineStart).toBe(before.baselineStart)
    })

    it('已開始的任務變成根任務：實際開工日不動，計畫開始日照樣釘住', async () => {
      const s = useTaskStore()
      const before = s.taskById('t4')!
      const dep = s.deps.find((d) => d.from === 't3' && d.to === 't4')!
      await s.removeDep(dep.id)
      const after = s.taskById('t4')!
      expect([after.start, after.baselineStart, after.baselineEnd]).toEqual([
        before.start,
        before.baselineStart,
        before.baselineEnd,
      ])
    })

    it('新增任務：計畫開始日＝設定的開始日，一建立就有計畫、不延遲', () => {
      const s = useTaskStore()
      const t = s.addTask({ groupId: 'g1', assigneeIds: [], start: '2026-10-01', duration: 3 })!
      expect([t.baselineStart, t.baselineEnd]).toEqual(['2026-10-01', '2026-10-05'])
      expect(isLate(s.taskById(t.id)!)).toBe(false)
    })

    it('explain：說明起訖是哪條規則決定的', () => {
      const s = useTaskStore()
      expect(s.explain('t5')).toEqual({ startBy: 'pred', predId: 't4', endBy: 'duration' })
      expect(s.explain('t3')).toMatchObject({ startBy: 'actual', endBy: 'overdue' })
      expect(s.explain('nope')).toBeNull()
    })
  })

  describe('編輯限制、排程說明與計數', () => {
    it('policyOf：t5 有前置未開始、t24 未開始根任務、t2 已完成；不存在回 LOCKED_POLICY', () => {
      const s = useTaskStore()
      expect(s.policyOf('t5').startBlock).toBe('predecessor')
      expect(s.policyOf('t24').warnPastStart).toBe(true)
      expect(s.policyOf('t2').durationBlock).toBe('done')
      expect(s.policyOf('nope')).toBe(LOCKED_POLICY)
    })

    it('改一筆：那筆的 policy 跟著變，其他任務沿用同一個 policy 物件（元件不會重繪）', async () => {
      const s = useTaskStore()
      const t3 = s.policyOf('t3')
      await s.updateTask('t24', { status: 'doing' })
      expect(s.policyOf('t24').startMaxIdx).toBe(dayIndex('2026-09-18'))
      expect(s.policyOf('t3')).toBe(t3)
    })

    it('懸空的相依（前置不存在）不算有前置：跟排程器一致', () => {
      const s = useTaskStore()
      s.deps.push({ id: 'ghost', from: 'nope', to: 't24' })
      expect(s.policyOf('t24').startBlock).toBeNull()
      expect(s.explain('t24')!.startBy).toBe('root')
    })

    it('explain 查表：t5 由前置 t4 決定；t3 逾期、原定 09-16 結束；不存在回 null', () => {
      const s = useTaskStore()
      expect(s.explain('t5')).toEqual({ startBy: 'pred', predId: 't4', endBy: 'duration' })
      expect(s.explain('t3')).toEqual({
        startBy: 'actual',
        endBy: 'overdue',
        originalEnd: dayIndex('2026-09-16'),
      })
      expect(s.explain('nope')).toBeNull()
    })

    it('leafTasks 與 counts：目前兩層，等於全部任務；09-18 計畫應完成 5、延遲 1', () => {
      const s = useTaskStore()
      expect(s.leafTasks).toHaveLength(30)
      expect(s.counts).toEqual({
        total: 30,
        byStatus: { todo: 18, doing: 7, paused: 1, done: 4 },
        planned: 5,
        late: 1,
      })
    })

    it('相依有環：警告一次並列出被略過的相依；之後的編輯不重複警告', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const s = useTaskStore()
      s.deps.push({ id: 'cyc', from: 't5', to: 't4' }) // t4 → t5 已存在，加反向成環
      await nextTick()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]![0])).toMatch(/相依有環.*\(t[45]\) → .*\(t[45]\)/)
      s.applyLocalPatch('t24', { name: '改名' })
      await nextTick()
      expect(warn).toHaveBeenCalledTimes(1)
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
