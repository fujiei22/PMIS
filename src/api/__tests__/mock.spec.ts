import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockApi } from '@/api/mock'
import { ApiError, type MockApi, type ProjectEvent } from '@/api/types'
import { sampleProject } from '@/mocks/sampleProject'
import type { Comment, Issue, Task } from '@/types/models'

/**
 * mock api 的行為契約（契約 A）。
 * 這支測試同時是「後端該長什麼樣」的可執行規格：真後端的 adapter 換上來之後，
 * 除了 failNext / setLatency / reset 這三個測試專用鉤子，其餘斷言都應該仍然成立。
 */

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  groupId: 'g1',
  name: id,
  created: '2026-09-01',
  start: '2026-09-01',
  end: '2026-09-05',
  status: 'todo',
  done: '',
  priority: 'mid',
  assigneeIds: [],
  ...over,
})

describe('mock api', () => {
  let api: MockApi
  let events: ProjectEvent[]
  let stop: () => void

  beforeEach(() => {
    api = createMockApi(sampleProject)
    events = []
    stop = api.subscribe((e) => events.push(e))
  })

  afterEach(() => {
    stop()
    vi.restoreAllMocks()
  })

  // ── 讀取 ────────────────────────────────────────────────────────────────
  it('loadProject 回整包資料，且每次都是新的拷貝（改回傳值不影響 mock）', async () => {
    const a = await api.loadProject()
    expect(a.tasks).toHaveLength(30)
    expect(a.groups).toHaveLength(6)
    expect(a.currentUserId).toBe(sampleProject.currentUserId)
    a.tasks[0]!.name = '被呼叫端改掉'
    const b = await api.loadProject()
    expect(b.tasks[0]!.name).not.toBe('被呼叫端改掉')
  })

  // ── 任務 ────────────────────────────────────────────────────────────────
  it('createTask 後 loadProject 看得到，並 emit task.created', async () => {
    const created = await api.createTask(task('new-1'))
    expect(created.id).toBe('new-1')
    const data = await api.loadProject()
    expect(data.tasks.some((t) => t.id === 'new-1')).toBe(true)
    expect(events).toEqual([{ type: 'task.created', payload: expect.objectContaining({ id: 'new-1' }) }])
  })

  it('createTask 重複 id → ApiError conflict（409），資料不變', async () => {
    const err = await api.createTask(task('t1')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('conflict')
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).method).toBe('createTask')
    expect((await api.loadProject()).tasks).toHaveLength(30)
    expect(events).toEqual([])
  })

  it('updateTask 只套有送的欄位並 emit task.updated；找不到 → not_found（404）', async () => {
    const out = await api.updateTask('t1', { name: '改名' })
    expect(out.name).toBe('改名')
    expect(out.start).toBe(sampleProject.tasks[0]!.start)
    expect(events[0]).toEqual({ type: 'task.updated', payload: expect.objectContaining({ name: '改名' }) })
    const err = await api.updateTask('nope', { name: 'x' }).catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('not_found')
    expect((err as ApiError).status).toBe(404)
  })

  it('updateTasks 整批覆蓋（cascade 結果由 client 算好），每筆各 emit 一次', async () => {
    const [a, b] = sampleProject.tasks
    const out = await api.updateTasks([
      { ...a!, start: '2026-08-01', end: '2026-08-05' },
      { ...b!, name: '批次改名' },
    ])
    expect(out).toHaveLength(2)
    expect(events.map((e) => e.type)).toEqual(['task.updated', 'task.updated'])
    const data = await api.loadProject()
    expect(data.tasks.find((t) => t.id === a!.id)!.start).toBe('2026-08-01')
    expect(data.tasks.find((t) => t.id === b!.id)!.name).toBe('批次改名')
  })

  it('deleteTask 連動刪 issue / dep / comment，各自 emit deleted', async () => {
    const before = await api.loadProject()
    const doomedIssues = before.issues.filter((i) => i.taskId === 't3').map((i) => i.id)
    const doomedDeps = before.deps.filter((d) => d.from === 't3' || d.to === 't3').map((d) => d.id)
    const targets = new Set<string>(['t3', ...doomedIssues])
    const doomedComments = before.comments.filter((c) => targets.has(c.targetId)).map((c) => c.id)
    expect(doomedIssues.length).toBeGreaterThan(0)
    expect(doomedDeps.length).toBeGreaterThan(0)
    expect(doomedComments.length).toBeGreaterThan(0)

    await api.deleteTask('t3')

    const after = await api.loadProject()
    expect(after.tasks.some((t) => t.id === 't3')).toBe(false)
    expect(after.issues.some((i) => doomedIssues.includes(i.id))).toBe(false)
    expect(after.deps.some((d) => doomedDeps.includes(d.id))).toBe(false)
    expect(after.comments.some((c) => doomedComments.includes(c.id))).toBe(false)

    const deletedIds = (type: ProjectEvent['type']) =>
      events.filter((e) => e.type === type).map((e) => (e.payload as { id: string }).id)
    expect(deletedIds('issue.deleted').sort()).toEqual(doomedIssues.slice().sort())
    expect(deletedIds('dep.deleted').sort()).toEqual(doomedDeps.slice().sort())
    expect(deletedIds('comment.deleted').sort()).toEqual(doomedComments.slice().sort())
    // 連動刪的事件先發，task.deleted 收尾
    expect(events[events.length - 1]).toEqual({ type: 'task.deleted', payload: { id: 't3' } })
  })

  it('reorderTasks 依送來的順序重排；groupId 有變的任務 emit task.updated', async () => {
    const before = await api.loadProject()
    const order = before.tasks.map((t) => ({ id: t.id, groupId: t.groupId }))
    const moved = order.splice(0, 1)[0]!
    order.push({ ...moved, groupId: 'g2' })
    await api.reorderTasks(order)
    const after = await api.loadProject()
    expect(after.tasks[after.tasks.length - 1]!.id).toBe(moved.id)
    expect(after.tasks[after.tasks.length - 1]!.groupId).toBe('g2')
    expect(events.map((e) => e.type)).toEqual(['task.updated'])
  })

  // ── 分類 / 相依 / Issue / 留言 ───────────────────────────────────────────
  it('分類 CRUD 與 reorderGroups；deleteGroup 連動刪底下的任務', async () => {
    const g = await api.createGroup({ id: 'gx', name: '新分類' })
    expect(g.name).toBe('新分類')
    await api.updateGroup('gx', { name: '改過的' })
    await api.reorderGroups(['gx', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'])
    let data = await api.loadProject()
    expect(data.groups[0]!.id).toBe('gx')
    expect(data.groups.find((x) => x.id === 'gx')!.name).toBe('改過的')

    await api.deleteGroup('g1')
    data = await api.loadProject()
    expect(data.groups.some((x) => x.id === 'g1')).toBe(false)
    expect(data.tasks.some((t) => t.groupId === 'g1')).toBe(false)
    expect(events.filter((e) => e.type === 'task.deleted').length).toBeGreaterThan(0)
    expect(events[events.length - 1]).toEqual({ type: 'group.deleted', payload: { id: 'g1' } })
  })

  it('createDep 擋自我相依 / 重複 / 成環；deleteDep 正常刪', async () => {
    const self = await api.createDep({ id: 'dx', from: 't1', to: 't1' }).catch((e: unknown) => e)
    expect((self as ApiError).code).toBe('validation')
    expect((self as ApiError).status).toBe(422)

    const data = await api.loadProject()
    const first = data.deps[0]!
    const dup = await api
      .createDep({ id: 'dy', from: first.from, to: first.to })
      .catch((e: unknown) => e)
    expect((dup as ApiError).code).toBe('conflict')

    const cycle = await api
      .createDep({ id: 'dz', from: first.to, to: first.from })
      .catch((e: unknown) => e)
    expect((cycle as ApiError).code).toBe('validation')

    const ok = await api.createDep({ id: 'dnew', from: 't1', to: 't5' })
    expect(ok.id).toBe('dnew')
    expect(events).toEqual([{ type: 'dep.created', payload: ok }])

    await api.deleteDep('dnew')
    expect((await api.loadProject()).deps.some((d) => d.id === 'dnew')).toBe(false)
    expect(events[events.length - 1]).toEqual({ type: 'dep.deleted', payload: { id: 'dnew' } })
  })

  it('Issue CRUD；deleteIssue 連動刪它的留言', async () => {
    const issue: Issue = {
      id: 'ix',
      taskId: 't3',
      created: '2026-09-18',
      title: '新 Issue',
      item: 'F',
      level: 'C',
      creatorId: 'm1',
      ownerIds: ['m1'],
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
    }
    await api.createIssue(issue)
    const updated = await api.updateIssue('ix', { status: 'closed' })
    expect(updated.status).toBe('closed')

    const comment: Comment = {
      id: 'cx',
      targetId: 'ix',
      targetKind: 'issue',
      memberId: 'm1',
      at: '2026-09-18T10:00',
      text: '掛在 Issue 上的留言',
      files: [],
    }
    await api.createComment(comment, [])
    await api.deleteIssue('ix')

    const data = await api.loadProject()
    expect(data.issues.some((i) => i.id === 'ix')).toBe(false)
    expect(data.comments.some((c) => c.id === 'cx')).toBe(false)
    expect(events.map((e) => e.type)).toEqual([
      'issue.created',
      'issue.updated',
      'comment.created',
      'comment.deleted',
      'issue.deleted',
    ])
  })

  it('createComment 帶檔案：response 的附件可以用 downloadAttachment 取回內容', async () => {
    const comment: Comment = {
      id: 'cfile',
      targetId: 't1',
      targetKind: 'task',
      memberId: 'm1',
      at: '2026-09-18T10:00',
      text: '附一個檔',
      files: [{ id: 'cfile:0', name: 'note.txt', size: 5, at: '2026-09-18' }],
    }
    const out = await api.createComment(comment, [new File(['hello'], 'note.txt')])
    expect(out.files[0]!.id).toBe('cfile:0')
    const blob = await api.downloadAttachment('cfile:0')
    expect(await blob.text()).toBe('hello')
    await api.deleteComment('cfile')
    expect((await api.loadProject()).comments.some((c) => c.id === 'cfile')).toBe(false)
  })

  it('downloadAttachment 對 mocks 的附件回 demo Blob；不存在 → not_found', async () => {
    const blob = await api.downloadAttachment('c1:0')
    expect(blob).toBeInstanceOf(Blob)
    expect(await blob.text()).toContain('nav-spec-v3.png')
    const err = await api.downloadAttachment('c1:99').catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('not_found')
  })

  // ── 事件 ────────────────────────────────────────────────────────────────
  it('事件同步發出、早於 response resolve；unsubscribe 後不再收到', async () => {
    const order: string[] = []
    const off = api.subscribe((e) => order.push('event:' + e.type))
    await api.updateTask('t1', { name: '順序測試' }).then(() => order.push('resolve'))
    expect(order).toEqual(['event:task.updated', 'resolve'])

    off()
    order.length = 0
    await api.updateTask('t1', { name: '退訂後' })
    expect(order).toEqual([])
  })

  it('有延遲時事件仍早於 resolve（事件不等 response）', async () => {
    api.setLatency(20)
    const order: string[] = []
    const off = api.subscribe(() => order.push('event'))
    const p = api.updateTask('t1', { name: '延遲' }).then(() => order.push('resolve'))
    expect(order).toEqual(['event'])
    await p
    expect(order).toEqual(['event', 'resolve'])
    off()
    api.setLatency(0)
  })

  it('emit 可以手動灌事件（供 R2 測試「事件晚於 response 到達」）', () => {
    const e: ProjectEvent = { type: 'task.deleted', payload: { id: 't9' } }
    api.emit(e)
    expect(events).toEqual([e])
  })

  it('handler 拋錯只進 console.error，不影響其他 handler 與呼叫端', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const later = vi.fn()
    const offBad = api.subscribe(() => {
      throw new Error('handler boom')
    })
    const offLater = api.subscribe(later)
    await expect(api.updateTask('t1', { name: 'ok' })).resolves.toMatchObject({ name: 'ok' })
    expect(later).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalled()
    offBad()
    offLater()
  })

  // ── 測試鉤子 ────────────────────────────────────────────────────────────
  it('failNext 擋下一次呼叫，再下一次成功；不會動到資料', async () => {
    api.failNext('updateTask')
    const err = await api.updateTask('t1', { name: '會失敗' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).method).toBe('updateTask')
    expect((await api.loadProject()).tasks[0]!.name).not.toBe('會失敗')
    expect(events).toEqual([])
    await expect(api.updateTask('t1', { name: '會成功' })).resolves.toMatchObject({
      name: '會成功',
    })
  })

  it('failNext(times=2) 擋兩次，第三次才過；只擋指定的方法', async () => {
    api.failNext('updateTask', new ApiError('network', '連不上', undefined, 'updateTask'), 2)
    await expect(api.updateTask('t1', { name: 'a' })).rejects.toThrow('連不上')
    await expect(api.updateTask('t1', { name: 'b' })).rejects.toThrow('連不上')
    await expect(api.updateTask('t1', { name: 'c' })).resolves.toBeDefined()
    // 其他方法不受影響
    api.failNext('createTask')
    await expect(api.createTask(task('t-ok'))).rejects.toBeInstanceOf(ApiError)
    await expect(api.updateTask('t1', { name: 'd' })).resolves.toBeDefined()
  })

  it('setLatency(20) 後 resolve 晚於 20ms', async () => {
    api.setLatency(20)
    const t0 = Date.now()
    await api.loadProject()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(19)
    api.setLatency(0)
  })

  it('reset() 回到初始資料，並清掉注入的延遲與失敗', async () => {
    await api.createTask(task('will-be-gone'))
    api.setLatency(50)
    api.failNext('loadProject')
    api.reset()
    const t0 = Date.now()
    const data = await api.loadProject()
    expect(Date.now() - t0).toBeLessThan(50)
    expect(data.tasks).toHaveLength(30)
    expect(data.tasks.some((t) => t.id === 'will-be-gone')).toBe(false)
  })

  it('reset(data) 換成指定的資料', async () => {
    api.reset({ groups: [], members: [], tasks: [], deps: [], issues: [], comments: [], currentUserId: 'm1' })
    expect((await api.loadProject()).tasks).toHaveLength(0)
  })
})
