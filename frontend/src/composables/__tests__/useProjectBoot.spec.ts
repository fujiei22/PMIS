import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { preloadProject, useProjectBoot } from '@/composables/useProjectBoot'
import { sampleProject } from '@/mocks/sampleProject'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { ProjectData } from '@/types/models'

/** 測試一定走 mock 實作（review F11：mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/**
 * 啟動層（契約 E）：資料 store 不認識 ui，所以
 * 「載入狀態」與「api 失敗的錯誤條」都在這裡接起來。
 */
describe('useProjectBoot', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.reset(structuredClone(sampleProject))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reload 成功 → loadState 走到 ready，資料進了 store', async () => {
    const boot = useProjectBoot()
    const ui = useUiStore()
    const pending = boot.reload()
    expect(ui.loadState).toBe('loading')
    await pending
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(useTaskStore().tasks).toHaveLength(30)
  })

  it('reload 失敗 → error 狀態與中文訊息，重試會成功', async () => {
    const boot = useProjectBoot()
    const ui = useUiStore()
    mockApi.failNext('loadProject')
    await boot.reload()
    expect(ui.loadState).toBe('error')
    expect(ui.loadError).toBeTruthy()

    await boot.reload()
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(useTaskStore().tasks).toHaveLength(30)
  })

  it('註冊 error sink：資料層的 api 失敗會進 ui.errors', async () => {
    const boot = useProjectBoot()
    const ui = useUiStore()
    await boot.reload()
    mockApi.failNext('updateTask')
    await useTaskStore().updateTask('t3', { name: '改到一半失敗' })
    expect(ui.errors[0]!.label).toBe('更新任務')
  })

  it('已 ready 再 reload（重進 Dashboard）：全程維持 ready，背景把新資料帶進來（G8）', async () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    await useProjectBoot().reload()
    // 離開期間資料被改了（等同別人改的；沒有 start 訂閱，事件沒進 store）
    await mockApi.updateTask('t3', { name: '離開時別人改的' })
    expect(tasks.taskById('t3')!.name).not.toBe('離開時別人改的')

    const p = useProjectBoot().reload()
    expect(ui.loadState).toBe('ready')
    await p
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(tasks.taskById('t3')!.name).toBe('離開時別人改的')
  })

  it('背景重載延到頁面第一幀畫出來之後才打 api：不在掛載的同一個 task 裡重算整頁', async () => {
    await useProjectBoot().reload()
    const spy = vi.spyOn(mockApi, 'loadProject')
    const p = useProjectBoot().reload()
    // 掛載那個 task 裡的 microtask 全部跑完，都還沒打
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(spy).not.toHaveBeenCalled()
    await p
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('背景重載失敗：維持 ready、不設 loadError，只記 console', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ui = useUiStore()
    await useProjectBoot().reload()
    mockApi.failNext('loadProject')
    await useProjectBoot().reload()
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(useTaskStore().tasks).toHaveLength(30)
    expect(err).toHaveBeenCalledWith('[api]', '載入專案（背景）', expect.any(ApiError))
  })

  it('較舊的一發晚失敗，不會把已經 ready 的畫面切成錯誤（跨兩次掛載）', async () => {
    const ui = useUiStore()
    let failOld!: (e: unknown) => void
    vi.spyOn(mockApi, 'loadProject').mockImplementationOnce(
      () => new Promise((_, rej) => { failOld = rej }),
    )
    // 第一次掛載：載入中
    const first = useProjectBoot().reload()
    expect(ui.loadState).toBe('loading')
    // 使用者離開又回來（新的一次掛載），這次成功
    await useProjectBoot().reload()
    expect(ui.loadState).toBe('ready')
    // 第一發這時才失敗：不能把畫面切成錯誤
    failOld(new ApiError('network', 'x'))
    await first
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
  })

  it('第一次載入中離開又回來：較早那發成功、後發失敗 → 維持 ready，資料還在', async () => {
    const ui = useUiStore()
    let okOld!: (v: ProjectData) => void
    let failNew!: (e: unknown) => void
    vi.spyOn(mockApi, 'loadProject')
      .mockImplementationOnce(() => new Promise((r) => { okOld = r }))
      .mockImplementationOnce(() => new Promise((_, rej) => { failNew = rej }))
    const first = useProjectBoot().reload()
    const second = useProjectBoot().reload()
    expect(ui.loadState).toBe('loading')
    okOld(structuredClone(sampleProject))
    await first
    expect(ui.loadState).toBe('ready')
    failNew(new ApiError('network', 'x'))
    await second
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(useTaskStore().tasks).toHaveLength(30)
  })

  it('切頁先載（G16 / C13）：掛載時的 reload 沿用同一發，不再打 api', async () => {
    const ui = useUiStore()
    const spy = vi.spyOn(mockApi, 'loadProject')
    preloadProject()
    // 不阻塞導航：只是開始，狀態先切成載入中（頁面還沒掛上，看不到）
    expect(ui.loadState).toBe('loading')
    expect(spy).toHaveBeenCalledTimes(1)
    await useProjectBoot().reload()
    expect(ui.loadState).toBe('ready')
    expect(useTaskStore().tasks).toHaveLength(30)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('先載失敗：掛載的 reload 沿用失敗結果顯示重試，按重試才再打一次', async () => {
    const ui = useUiStore()
    const spy = vi.spyOn(mockApi, 'loadProject')
    mockApi.failNext('loadProject')
    preloadProject()
    const boot = useProjectBoot()
    await boot.reload()
    expect(ui.loadState).toBe('error')
    expect(ui.loadError).toBeTruthy()
    expect(spy).toHaveBeenCalledTimes(1)

    await boot.reload()
    expect(ui.loadState).toBe('ready')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('已 ready 時先載：走背景、維持 ready，而且立刻打（頁面還沒掛上，不必等第一幀）', async () => {
    const ui = useUiStore()
    await useProjectBoot().reload()
    const spy = vi.spyOn(mockApi, 'loadProject')
    preloadProject()
    expect(ui.loadState).toBe('ready')
    expect(spy).toHaveBeenCalledTimes(1)
    await useProjectBoot().reload()
    expect(ui.loadState).toBe('ready')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('start 只訂閱一次，stop 之後事件不再進來', async () => {
    const boot = useProjectBoot()
    const tasks = useTaskStore()
    await boot.reload()
    boot.start()
    boot.start()
    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '別人改的' } })
    expect(tasks.taskById('t3')!.name).toBe('別人改的')

    boot.stop()
    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '停掉之後' } })
    expect(tasks.taskById('t3')!.name).toBe('別人改的')
  })
})