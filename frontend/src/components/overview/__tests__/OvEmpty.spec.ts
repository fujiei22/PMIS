/**
 * 總覽空狀態 OvEmpty 的測試。
 *
 * 測什麼：完全沒有專案時只顯示「目前沒有專案」、不給按鈕；
 * 有專案但全被篩掉時顯示「沒有符合條件的專案」，按「清除篩選」會清掉所有條件。
 * 為什麼：兩種情境使用者能做的事不同——沒資料時清篩選沒有意義，被篩掉時要給一條回頭路。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildPortfolio } from '@/api/mock/portfolio'
import OvEmpty from '@/components/overview/OvEmpty.vue'
import { sampleProject } from '@/mocks/sampleProject'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

describe('OvEmpty', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('完全沒有專案：「目前沒有專案」、沒有按鈕', () => {
    const w = mount(OvEmpty)
    expect(w.text()).toContain('目前沒有專案')
    expect(w.find('button').exists()).toBe(false)
  })

  it('被篩掉：「沒有符合條件的專案」＋ 清除篩選', async () => {
    await usePortfolioStore().load(buildPortfolio(sampleProject, '2026-09-22'))
    const ov = useOverviewStore()
    ov.toggleStatus('done'); ov.toggleAlert('late')
    const w = mount(OvEmpty)
    expect(w.text()).toContain('沒有符合條件的專案')
    await w.find('button').trigger('click')
    expect(ov.anyFilter).toBe(false)
  })
})
