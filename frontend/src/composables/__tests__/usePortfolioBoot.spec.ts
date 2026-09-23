import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { usePortfolioBoot } from '@/composables/usePortfolioBoot'
import { API_ERROR_TEXT } from '@/constants/dashboard'
import { ApiError } from '@/api/types'
import { useOverviewStore } from '@/stores/overview'

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
})
