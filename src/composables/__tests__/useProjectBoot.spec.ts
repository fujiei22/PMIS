import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi as maybeMockApi } from '@/api'
import { useProjectBoot } from '@/composables/useProjectBoot'
import { sampleProject } from '@/mocks/sampleProject'
import { useTaskStore } from '@/stores/task'
import { useUiStore } from '@/stores/ui'

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