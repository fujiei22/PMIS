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

  it('兩發交錯時只套用最後一發：先發的晚回來也不會蓋掉新資料', async () => {
    const pf = usePortfolioStore()
    const newer = buildPortfolio(sampleProject, '2026-09-22')
    newer.projects[1]!.name = '新的'
    let releaseOld!: (v: Awaited<ReturnType<typeof api.listProjects>>) => void
    vi.spyOn(api, 'listProjects')
      .mockImplementationOnce(() => new Promise((r) => { releaseOld = r }))
      .mockResolvedValueOnce(newer)
    const first = pf.load()
    await pf.load()
    expect(pf.projects[1]!.name).toBe('新的')
    releaseOld(buildPortfolio(sampleProject, '2026-09-22'))
    await first
    expect(pf.projects[1]!.name).toBe('新的')
    vi.restoreAllMocks()
  })
})
