import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mockApi as maybeMockApi } from '@/api'
import { ApiError } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import type { SessionInfo } from '@/types/models'

/** 測試一定走 mock 實作（mockApi 在型別上是 optional）。 */
const mockApi = maybeMockApi!

/** mock 預設的登入者（總覽的 m11）。 */
const ME: SessionInfo = { memberId: 'm11', name: '成員11', role: 'PM 主管' }

/** 登入者資料層：問後端、登入、登出、清掉；晚回來的舊結果不蓋掉新狀態。 */
describe('session store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockApi.reset()
  })

  it('一開始還沒問過後端；load() 之後記下登入者', async () => {
    const s = useSessionStore()
    expect(s.checked).toBe(false)
    expect(s.info).toBeNull()
    await s.load()
    expect(s.checked).toBe(true)
    expect(s.info).toEqual(ME)
  })

  it('沒登入：load() 之後 checked 但 info 是 null', async () => {
    mockApi.setSession(null)
    const s = useSessionStore()
    await s.load()
    expect(s.checked).toBe(true)
    expect(s.info).toBeNull()
  })

  it('load() 失敗（連不上）往上拋，checked 留 false（下次導航再問）', async () => {
    mockApi.failNext('getSession')
    const s = useSessionStore()
    await expect(s.load()).rejects.toBeInstanceOf(ApiError)
    expect(s.checked).toBe(false)
    expect(s.info).toBeNull()
  })

  it('login 成功記下登入者；失敗原樣回傳原因、不動狀態', async () => {
    mockApi.setSession(null)
    const s = useSessionStore()
    expect(await s.login('outsider', 'pw')).toEqual({ ok: false, reason: 'forbidden' })
    expect(s.info).toBeNull()
    const ok = await s.login('chen_daming', 'pw')
    expect(ok).toEqual({ ok: true, session: ME })
    expect(s.info).toEqual(ME)
    expect(s.checked).toBe(true)
  })

  it('logout：後端登出、本地馬上記成沒登入（checked 回 false，下次導航再問）', async () => {
    const s = useSessionStore()
    await s.load()
    const spy = vi.spyOn(api, 'logout')
    await s.logout()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(s.info).toBeNull()
    expect(s.checked).toBe(false)
    expect(await api.getSession()).toBeNull()
  })

  it('logout 後端失敗（連不上）也照樣登出，只記 console', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = useSessionStore()
    await s.load()
    mockApi.failNext('logout')
    await s.logout()
    expect(s.info).toBeNull()
    expect(err).toHaveBeenCalledWith('[api]', '登出', expect.any(ApiError))
  })

  it('問到一半就 clear()：晚回來的「已登入」不蓋掉（剛登出的人不會又變成登入）', async () => {
    const s = useSessionStore()
    let release!: (v: SessionInfo | null) => void
    vi.spyOn(api, 'getSession').mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    const p = s.load()
    s.clear()
    release(ME)
    await p
    expect(s.info).toBeNull()
    expect(s.checked).toBe(false)
  })
})
