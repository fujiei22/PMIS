import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi as maybeMockApi } from '@/api'
import router from '@/router'
import { useSessionStore } from '@/stores/session'

/** 測試一定走 mock 實作（mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

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

/**
 * 登入守衛（F3）：排在先載守衛之前，沒登入的導航不會先打出要登入的請求；
 * 只在第一次導航（store 還沒問過）問 getSession，之後切頁不多等一發。
 */
describe('router：登入守衛', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.reset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockApi.reset()
  })

  it('沒登入：導到登入頁並帶原路徑；Dashboard 與總覽都不先載', async () => {
    mockApi.setSession(null)
    const list = vi.spyOn(api, 'listProjects')
    const load = vi.spyOn(api, 'loadProject')
    const me = vi.spyOn(api, 'getSession')
    await router.push('/projects/pmis')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/projects/pmis')
    expect(me).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('登入頁不用登入就進得去，也不先載任何東西', async () => {
    mockApi.setSession(null)
    const list = vi.spyOn(api, 'listProjects')
    const load = vi.spyOn(api, 'loadProject')
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('login')
    expect(list).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('已登入：第一次導航問一次 getSession，之後切頁直接看 store', async () => {
    const me = vi.spyOn(api, 'getSession')
    await router.push('/projects/a')
    await router.push('/')
    await router.push('/projects/b')
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(me).toHaveBeenCalledTimes(1)
    expect(useSessionStore().info?.memberId).toBe('m11')
  })

  it('問不到（連不上）：當沒登入、到登入頁；下次導航再問，登入著就照常進', async () => {
    const me = vi.spyOn(api, 'getSession')
    mockApi.failNext('getSession')
    await router.push('/projects/c')
    expect(router.currentRoute.value.name).toBe('login')
    await router.push('/projects/c')
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(me).toHaveBeenCalledTimes(2)
  })
})
