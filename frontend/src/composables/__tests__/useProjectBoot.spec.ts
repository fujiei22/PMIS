import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { preloadProject, useProjectBoot } from '@/composables/useProjectBoot'
import { sampleProject } from '@/mocks/sampleProject'
import { useBudgetStore } from '@/stores/budget'
import { useCommentStore } from '@/stores/comment'
import { useFilterStore } from '@/stores/filter'
import { useIssueStore } from '@/stores/issue'
import { useMemberStore } from '@/stores/member'
import { useProjectStore } from '@/stores/project'
import { useSelectionStore } from '@/stores/selection'
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
    const boot = useProjectBoot('pmis')
    const ui = useUiStore()
    const pending = boot.reload()
    expect(ui.loadState).toBe('loading')
    await pending
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(useTaskStore().tasks).toHaveLength(30)
  })

  it('reload 失敗 → error 狀態與中文訊息，重試會成功', async () => {
    const boot = useProjectBoot('pmis')
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
    const boot = useProjectBoot('pmis')
    const ui = useUiStore()
    await boot.reload()
    mockApi.failNext('updateTask')
    await useTaskStore().updateTask('t3', { name: '改到一半失敗' })
    expect(ui.errors[0]!.label).toBe('更新任務')
  })

  it('已 ready 再 reload（重進 Dashboard）：全程維持 ready，背景把新資料帶進來（G8）', async () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    await useProjectBoot('pmis').reload()
    // 離開期間資料被改了（等同別人改的；沒有 start 訂閱，事件沒進 store）
    await mockApi.updateTask('t3', { name: '離開時別人改的' })
    expect(tasks.taskById('t3')!.name).not.toBe('離開時別人改的')

    const p = useProjectBoot('pmis').reload()
    expect(ui.loadState).toBe('ready')
    await p
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(tasks.taskById('t3')!.name).toBe('離開時別人改的')
  })

  it('背景重載延到頁面第一幀畫出來之後才打 api：不在掛載的同一個 task 裡重算整頁', async () => {
    await useProjectBoot('pmis').reload()
    const spy = vi.spyOn(mockApi, 'loadProject')
    const p = useProjectBoot('pmis').reload()
    // 掛載那個 task 裡的 microtask 全部跑完，都還沒打
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(spy).not.toHaveBeenCalled()
    await p
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('背景重載失敗：維持 ready、不設 loadError，只記 console', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ui = useUiStore()
    await useProjectBoot('pmis').reload()
    mockApi.failNext('loadProject')
    await useProjectBoot('pmis').reload()
    expect(ui.loadState).toBe('ready')
    expect(ui.loadError).toBeNull()
    expect(useTaskStore().tasks).toHaveLength(30)
    expect(err).toHaveBeenCalledWith('[api]', '載入專案（背景）', expect.any(ApiError))
  })

  it('較舊的一發晚失敗，不會把已經 ready 的畫面切成錯誤（跨兩次掛載）', async () => {
    const ui = useUiStore()
    let failOld!: (e: unknown) => void
    vi.spyOn(mockApi, 'loadProject').mockImplementationOnce(
      () =>
        new Promise((_, rej) => {
          failOld = rej
        }),
    )
    // 第一次掛載：載入中
    const first = useProjectBoot('pmis').reload()
    expect(ui.loadState).toBe('loading')
    // 使用者離開又回來（新的一次掛載），這次成功
    await useProjectBoot('pmis').reload()
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
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            okOld = r
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, rej) => {
            failNew = rej
          }),
      )
    const first = useProjectBoot('pmis').reload()
    const second = useProjectBoot('pmis').reload()
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
    preloadProject('pmis')
    // 不阻塞導航：只是開始，狀態先切成載入中（頁面還沒掛上，看不到）
    expect(ui.loadState).toBe('loading')
    expect(spy).toHaveBeenCalledTimes(1)
    await useProjectBoot('pmis').reload()
    expect(ui.loadState).toBe('ready')
    expect(useTaskStore().tasks).toHaveLength(30)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('先載失敗：掛載的 reload 沿用失敗結果顯示重試，按重試才再打一次', async () => {
    const ui = useUiStore()
    const spy = vi.spyOn(mockApi, 'loadProject')
    mockApi.failNext('loadProject')
    preloadProject('pmis')
    const boot = useProjectBoot('pmis')
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
    await useProjectBoot('pmis').reload()
    const spy = vi.spyOn(mockApi, 'loadProject')
    preloadProject('pmis')
    expect(ui.loadState).toBe('ready')
    expect(spy).toHaveBeenCalledTimes(1)
    await useProjectBoot('pmis').reload()
    expect(ui.loadState).toBe('ready')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('已 ready 但換了專案：不走背景重載、切回載入中，畫面不先秀上一個專案的資料', async () => {
    const ui = useUiStore()
    preloadProject('pmis')
    await useProjectBoot('pmis').reload()
    expect(ui.loadState).toBe('ready')

    preloadProject('other')
    expect(ui.loadState).toBe('loading')
    await useProjectBoot('other').reload()
    expect(ui.loadState).toBe('ready')

    // 再進同一個專案才走背景
    preloadProject('other')
    expect(ui.loadState).toBe('ready')
    await useProjectBoot('other').reload()
  })

  it('路由的專案 id 一路傳到 api.loadProject(id)：先載與自己載都是', async () => {
    const spy = vi.spyOn(mockApi, 'loadProject')
    preloadProject('abc')
    await useProjectBoot('abc').reload()
    expect(spy).toHaveBeenLastCalledWith('abc')
    // 先載的不是這一頁的專案（不會發生，防呆）：不沿用，自己載這一頁的
    preloadProject('stale')
    await useProjectBoot('xyz').reload()
    expect(spy).toHaveBeenLastCalledWith('xyz')
  })

  it('換專案：先清空整個資料層與選取、篩選、暫態，再走載入中（README〈還沒做的〉第 3 點）', async () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const filter = useFilterStore()
    const selection = useSelectionStore()
    const comment = useCommentStore()
    preloadProject('pmis')
    await useProjectBoot('pmis').reload()
    // 在上一個專案留下的東西
    selection.taskId = 't3'
    filter.memberIds = ['m1']
    filter.groupIds = ['g1']
    filter.bumpTaskSort('name')
    const sort = filter.taskSort.map((k) => ({ ...k }))
    comment.draft = '打到一半'
    ui.pushError({ label: '更新任務', error: new ApiError('network', 'x') })

    let release!: () => void
    vi.spyOn(mockApi, 'loadProject').mockImplementationOnce(
      () => new Promise((r) => (release = () => r(structuredClone(sampleProject)))),
    )
    preloadProject('other')
    // 新專案的資料還沒到：畫面是載入中，store 裡沒有任何上一個專案的東西
    expect(ui.loadState).toBe('loading')
    expect(tasks.tasks).toEqual([])
    expect(tasks.groups).toEqual([])
    expect(tasks.deps).toEqual([])
    expect(useIssueStore().issues).toEqual([])
    expect(comment.comments).toEqual([])
    expect(comment.draft).toBe('')
    expect(useMemberStore().members).toEqual([])
    expect(useBudgetStore().budget).toEqual({ total: 0, actual: 0 })
    expect(useProjectStore().meta.name).toBe('')
    expect(useProjectStore().canEdit).toBe(false)
    expect(selection.taskId).toBeNull()
    expect(filter.memberIds).toEqual([])
    expect(filter.groupIds).toEqual([])
    expect(ui.errors).toEqual([])
    // 排序是版面偏好，跟離開 Dashboard 時一樣留著
    expect(filter.taskSort).toEqual(sort)

    release()
    await useProjectBoot('other').reload()
    expect(ui.loadState).toBe('ready')
    expect(tasks.tasks).toHaveLength(30)
    expect(useProjectStore().meta.id).toBe('pmis')
  })

  it('同一個專案重進（背景重載）不清空：選取與篩選留著', async () => {
    const filter = useFilterStore()
    const selection = useSelectionStore()
    preloadProject('pmis')
    await useProjectBoot('pmis').reload()
    selection.taskId = 't3'
    filter.memberIds = ['m1']
    preloadProject('pmis')
    expect(useTaskStore().tasks).toHaveLength(30)
    await useProjectBoot('pmis').reload()
    expect(selection.taskId).toBe('t3')
    expect(filter.memberIds).toEqual(['m1'])
  })

  it('等 A 的時候換到 B：A 晚回來（成功或失敗）都不算數，畫面只跟著 B 走', async () => {
    const ui = useUiStore()
    const tasks = useTaskStore()
    const a = structuredClone(sampleProject)
    a.tasks[0]!.name = '專案 A'
    let okA!: () => void
    let failA2!: (e: unknown) => void
    let okB!: () => void
    vi.spyOn(mockApi, 'loadProject')
      .mockImplementationOnce(() => new Promise((r) => (okA = () => r(a))))
      .mockImplementationOnce(
        () => new Promise((r) => (okB = () => r(structuredClone(sampleProject)))),
      )
      .mockImplementationOnce(() => new Promise((_, rej) => (failA2 = rej)))
      .mockImplementationOnce(() => new Promise(() => {}))

    preloadProject('a')
    const first = useProjectBoot('a').reload()
    preloadProject('b')
    okA()
    await first
    // A 的資料沒有灌進來，畫面也沒有被 A 切成 ready
    expect(ui.loadState).toBe('loading')
    expect(tasks.tasks).toEqual([])
    okB()
    await useProjectBoot('b').reload()
    expect(ui.loadState).toBe('ready')
    expect(tasks.tasks[0]!.name).not.toBe('專案 A')

    // 回到 A 又馬上換到 C：A 失敗不能把 C 的畫面切成錯誤
    preloadProject('a')
    const again = useProjectBoot('a').reload()
    preloadProject('c')
    failA2(new ApiError('network', 'x'))
    await again
    expect(ui.loadState).toBe('loading')
    expect(ui.loadError).toBeNull()
  })

  it('start 只訂閱一次（訂的是這一頁的專案），stop 之後事件不再進來', async () => {
    const boot = useProjectBoot('pmis')
    const tasks = useTaskStore()
    const subscribe = vi.spyOn(mockApi, 'subscribe')
    await boot.reload()
    boot.start()
    boot.start()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith('pmis', expect.any(Function))
    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '別人改的' } })
    expect(tasks.taskById('t3')!.name).toBe('別人改的')

    boot.stop()
    mockApi.emit({ type: 'task.updated', payload: { ...tasks.taskById('t3')!, name: '停掉之後' } })
    expect(tasks.taskById('t3')!.name).toBe('別人改的')
  })
})
