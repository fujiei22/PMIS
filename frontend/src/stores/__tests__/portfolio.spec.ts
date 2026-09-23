import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPortfolio } from '@/api/mock/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { usePortfolioStore } from '@/stores/portfolio'
import { api } from '@/api'

/** 總覽資料層：load(data) 直接套用、load() 走 api；失敗 throw 且不清舊資料。 */

describe('portfolio store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('load(data) 直接套用；byId 查不到回 undefined', async () => {
    const pf = usePortfolioStore()
    await pf.load(buildPortfolio(sampleProject, '2026-09-22'))
    expect(pf.projects).toHaveLength(7)
    expect(pf.byId('m8')?.name).toBe('成員8')
    expect(pf.byId('nope')).toBeUndefined()
    expect(pf.projectById('wiki')?.name).toBe('內部知識庫')
  })

  it('load() 走 api；失敗時 throw 而且不清掉舊資料', async () => {
    const pf = usePortfolioStore()
    await pf.load()
    expect(pf.projects).toHaveLength(7)
    vi.spyOn(api, 'listProjects').mockRejectedValueOnce(new Error('boom'))
    await expect(pf.load()).rejects.toThrow('boom')
    expect(pf.projects).toHaveLength(7)
    vi.restoreAllMocks()
  })
})
