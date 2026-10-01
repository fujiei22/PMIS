import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { preloadPortfolio, usePortfolioBoot } from '@/composables/usePortfolioBoot'
import { API_ERROR_TEXT } from '@/constants/api'
import { ApiError } from '@/api/types'
import { buildPortfolio } from '@/api/mock/portfolio'
import { sampleProject } from '@/mocks/sampleProject'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

/**
 * 總覽啟動層：第一次載入顯示 loading；已 ready 再重載時全程維持 ready（回總覽不閃，spec 7b），
 * 背景失敗只記 console、不蓋畫面。
 */

describe('usePortfolioBoot', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('第一次：loading → ready', async () => {
    const ov = useOverviewStore()
    const p = usePortfolioBoot().reload()
    expect(ov.loadState).toBe('loading')
    await p
    expect(ov.loadState).toBe('ready')
  })

  it('第一次失敗：error ＋ 中文錯誤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(api, 'listProjects').mockRejectedValueOnce(new ApiError('network', 'x'))
    const ov = useOverviewStore()
    await usePortfolioBoot().reload()
    expect(ov.loadState).toBe('error')
    expect(ov.loadError).toBe(API_ERROR_TEXT.network)
  })

  it('已 ready 再 reload：全程維持 ready（不閃）；失敗也不蓋畫面，只記 console', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ov = useOverviewStore()
    const boot = usePortfolioBoot()
    await boot.reload()
    const p = boot.reload()
    expect(ov.loadState).toBe('ready')
    await p
    vi.spyOn(api, 'listProjects').mockRejectedValueOnce(new ApiError('network', 'x'))
    await boot.reload()
    expect(ov.loadState).toBe('ready')
    expect(ov.loadError).toBeNull()
    expect(err).toHaveBeenCalledWith('[api]', '載入專案清單（背景）', expect.any(ApiError))
  })

  it('較舊的一發晚失敗，不會把已經 ready 的畫面切成錯誤（跨兩次掛載）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ov = useOverviewStore()
    let failOld!: (e: unknown) => void
    vi.spyOn(api, 'listProjects').mockImplementationOnce(() => new Promise((_, rej) => { failOld = rej }))
    // 第一次掛載：載入中
    const first = usePortfolioBoot().reload()
    expect(ov.loadState).toBe('loading')
    // 使用者離開又回來（新的一次掛載），這次成功
    await usePortfolioBoot().reload()
    expect(ov.loadState).toBe('ready')
    // 第一發這時才失敗：不能把畫面切成錯誤
    failOld(new ApiError('network', 'x'))
    await first
    expect(ov.loadState).toBe('ready')
    expect(ov.loadError).toBeNull()
  })

  it('切頁先載（G16 / C13）：掛載時的 reload 沿用同一發，不再打 api', async () => {
    const ov = useOverviewStore()
    const spy = vi.spyOn(api, 'listProjects')
    preloadPortfolio()
    expect(ov.loadState).toBe('loading')
    expect(spy).toHaveBeenCalledTimes(1)
    await usePortfolioBoot().reload()
    expect(ov.loadState).toBe('ready')
    expect(usePortfolioStore().projects).toHaveLength(7)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('先載失敗：掛載的 reload 沿用失敗結果顯示重試，按重試才再打一次', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ov = useOverviewStore()
    const spy = vi.spyOn(api, 'listProjects').mockRejectedValueOnce(new ApiError('network', 'x'))
    preloadPortfolio()
    const boot = usePortfolioBoot()
    await boot.reload()
    expect(ov.loadState).toBe('error')
    expect(ov.loadError).toBe(API_ERROR_TEXT.network)
    expect(spy).toHaveBeenCalledTimes(1)

    await boot.reload()
    expect(ov.loadState).toBe('ready')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('第一次載入中離開又回來：較早那發成功、後發失敗 → 維持 ready，資料還在', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ov = useOverviewStore()
    const pf = usePortfolioStore()
    let okOld!: (v: Awaited<ReturnType<typeof api.listProjects>>) => void
    let failNew!: (e: unknown) => void
    vi.spyOn(api, 'listProjects')
      .mockImplementationOnce(() => new Promise((r) => { okOld = r }))
      .mockImplementationOnce(() => new Promise((_, rej) => { failNew = rej }))
    const first = usePortfolioBoot().reload()
    const second = usePortfolioBoot().reload()
    expect(ov.loadState).toBe('loading')
    okOld(buildPortfolio(sampleProject, '2026-09-22'))
    await first
    expect(ov.loadState).toBe('ready')
    failNew(new ApiError('network', 'x'))
    await second
    expect(ov.loadState).toBe('ready')
    expect(ov.loadError).toBeNull()
    expect(pf.projects).toHaveLength(7)
  })
})
