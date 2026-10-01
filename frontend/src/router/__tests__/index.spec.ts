import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import router from '@/router'

/**
 * 切頁時先開始載目標頁的資料（G16 / C13）：導航一開始就打，不等新頁掛上。
 * router 是模組單例，這幾條依序共用同一條導航歷史。
 */
describe('router：切頁先載', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('初始導航到總覽也會先載（START_LOCATION 的 path 也是 /，不能只比 path）', async () => {
    const list = vi.spyOn(api, 'listProjects')
    const load = vi.spyOn(api, 'loadProject')
    await router.push('/')
    expect(list).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
  })

  it('同一頁只換 hash / query 不會重掛頁面，也就不先載', async () => {
    const list = vi.spyOn(api, 'listProjects')
    await router.push('/#timeline')
    await router.push('/?q=1')
    expect(list).not.toHaveBeenCalled()
  })

  it('進 Dashboard 先載專案；換到另一個專案（path 不同）也先載', async () => {
    const load = vi.spyOn(api, 'loadProject')
    await router.push('/projects/pmis')
    expect(load).toHaveBeenCalledTimes(1)
    await router.push('/projects/pmis#x')
    expect(load).toHaveBeenCalledTimes(1)
    await router.push('/projects/other')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('打錯的網址導回總覽：先載的是總覽', async () => {
    const list = vi.spyOn(api, 'listProjects')
    const load = vi.spyOn(api, 'loadProject')
    await router.push('/nope/nope')
    expect(router.currentRoute.value.name).toBe('overview')
    expect(list).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
  })
})
