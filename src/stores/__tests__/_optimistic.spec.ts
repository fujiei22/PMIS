import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/types'
import {
  applyServerValue,
  createTracker,
  runOptimistic,
  setErrorSink,
  type Tracker,
} from '@/stores/_optimistic'
import { useUiStore } from '@/stores/ui'

/** 測試用的最小實體。 */
interface Row {
  id: string
  name: string
}

describe('runOptimistic', () => {
  let tracker: Tracker<Row>
  let local: Map<string, Row>
  /** 把本地對齊 server；undefined = 已刪除。 */
  const reconcile = (server: Row | undefined, id: string): void => {
    if (server) local.set(id, { ...server })
    else local.delete(id)
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    tracker = createTracker<Row>()
    tracker.server.set('r1', { id: 'r1', name: 'server' })
    local = new Map([['r1', { id: 'r1', name: 'server' }]])
    // 錯誤出口是注入的（契約 E）：正式啟動由 useProjectBoot 掛，測試自己掛
    setErrorSink((e) => useUiStore().pushError(e))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    setErrorSink(null)
    vi.restoreAllMocks()
  })

  it('resolve 後 server 更新且本地被 reconcile 成 response', async () => {
    local.set('r1', { id: 'r1', name: '本地' })
    await runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '更新資料',
      call: async () => ({ id: 'r1', name: 'server 糾正過的' }),
      reconcile,
    })

    expect(tracker.server.get('r1')!.name).toBe('server 糾正過的')
    expect(local.get('r1')!.name).toBe('server 糾正過的')
    expect(tracker.inflight.get('r1') ?? 0).toBe(0)
  })

  it('call 回陣列時每一筆都寫進 server', async () => {
    tracker.server.set('r2', { id: 'r2', name: 'server2' })
    local.set('r2', { id: 'r2', name: 'server2' })
    await runOptimistic<Row>({
      tracker,
      ids: ['r1', 'r2'],
      label: '批次更新',
      call: async () => [
        { id: 'r1', name: 'a' },
        { id: 'r2', name: 'b' },
      ],
      reconcile,
    })
    expect(local.get('r1')!.name).toBe('a')
    expect(local.get('r2')!.name).toBe('b')
  })

  it('reject 時 pushError（帶 code / cause）、console.error 並還原成 server', async () => {
    const err = new ApiError('validation', '欄位不合法', 422, 'updateTask')
    local.set('r1', { id: 'r1', name: '本地' })
    await runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '更新資料',
      call: () => Promise.reject(err),
      reconcile,
    })

    const ui = useUiStore()
    expect(ui.errors).toHaveLength(1)
    expect(ui.errors[0]!.label).toBe('更新資料')
    expect(ui.errors[0]!.code).toBe('validation')
    expect(ui.errors[0]!.cause).toBe(err)
    expect(console.error).toHaveBeenCalledWith('[api]', '更新資料', err)
    expect(local.get('r1')!.name).toBe('server')
    expect(tracker.inflight.get('r1') ?? 0).toBe(0)
  })

  it('永不 throw', async () => {
    await expect(
      runOptimistic<Row>({
        tracker,
        ids: ['r1'],
        label: '更新資料',
        call: () => Promise.reject(new Error('爆了')),
        reconcile,
      }),
    ).resolves.toBeUndefined()
  })

  it('兩筆 in-flight：第一筆失敗、第二筆成功 → 最終等於第二筆的 response', async () => {
    let failFirst: (e: unknown) => void = () => {}
    let okSecond: (r: Row) => void = () => {}
    local.set('r1', { id: 'r1', name: '本地1' })
    const first = runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '第一筆',
      call: () => new Promise<Row>((_, reject) => (failFirst = reject)),
      reconcile,
    })
    local.set('r1', { id: 'r1', name: '本地2' })
    const second = runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '第二筆',
      call: () => new Promise<Row>((resolve) => (okSecond = resolve)),
      reconcile,
    })
    expect(tracker.inflight.get('r1')).toBe(2)

    failFirst(new ApiError('network', '斷線'))
    await first
    // 還有一筆在飛 → 先不還原
    expect(local.get('r1')!.name).toBe('本地2')

    okSecond({ id: 'r1', name: 'server2' })
    await second
    expect(local.get('r1')!.name).toBe('server2')
    expect(tracker.server.get('r1')!.name).toBe('server2')
  })

  it('tracker 沒有 failed 這張表（review F9）', () => {
    expect('failed' in createTracker<Row>()).toBe(false)
  })

  it('不吃 apply，本地由呼叫端自己先改好（review F9）', async () => {
    local.set('r1', { id: 'r1', name: '本地' })
    await runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '更新資料',
      call: async () => ({ id: 'r1', name: 'server 糾正過的' }),
      reconcile,
    })
    expect(local.get('r1')!.name).toBe('server 糾正過的')
  })

  it('call 回 void 時不動 server（刪除由呼叫端自己清）', async () => {
    local.delete('r1')
    await runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '刪除資料',
      call: async () => {
        tracker.server.delete('r1')
      },
      reconcile,
    })
    expect(tracker.server.has('r1')).toBe(false)
    expect(local.has('r1')).toBe(false)
  })
})

describe('applyServerValue（事件進來時的處理）', () => {
  let tracker: Tracker<Row>
  let local: Map<string, Row>
  const reconcile = (server: Row | undefined, id: string): void => {
    if (server) local.set(id, { ...server })
    else local.delete(id)
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    tracker = createTracker<Row>()
    tracker.server.set('r1', { id: 'r1', name: 'server' })
    local = new Map([['r1', { id: 'r1', name: 'server' }]])
  })

  it('沒有 in-flight 時直接 reconcile 到本地', () => {
    applyServerValue(tracker, 'r1', { id: 'r1', name: '別人改的' }, reconcile)
    expect(local.get('r1')!.name).toBe('別人改的')
  })

  it('in-flight 期間只寫 server，歸零後才對齊', async () => {
    let finish: (r: Row) => void = () => {}
    local.set('r1', { id: 'r1', name: '我改的' })
    const op = runOptimistic<Row>({
      tracker,
      ids: ['r1'],
      label: '更新資料',
      call: () => new Promise<Row>((resolve) => (finish = resolve)),
      reconcile,
    })

    applyServerValue(tracker, 'r1', { id: 'r1', name: '別人改的' }, reconcile)
    expect(tracker.server.get('r1')!.name).toBe('別人改的')
    expect(local.get('r1')!.name).toBe('我改的')

    finish({ id: 'r1', name: '我改的' })
    await op
    expect(local.get('r1')!.name).toBe('我改的')
  })

  it('值是 undefined 代表已刪除', () => {
    applyServerValue(tracker, 'r1', undefined, reconcile)
    expect(tracker.server.has('r1')).toBe(false)
    expect(local.has('r1')).toBe(false)
  })
})
