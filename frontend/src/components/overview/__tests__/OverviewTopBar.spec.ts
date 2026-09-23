// 總覽頂欄：標題、登入者、成員 / 狀態 / 需注意篩選、清除篩選、檢視切換、載入前停用。
// 完整的使用者流程（篩選後卡片跟著變）由 Task 11 的 e2e 覆蓋。
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildPortfolio } from '@/api/mock/portfolio'
import OverviewTopBar from '@/components/overview/OverviewTopBar.vue'
import { sampleProject } from '@/mocks/sampleProject'
import { useClockStore } from '@/stores/clock'
import { useOverviewStore } from '@/stores/overview'
import { usePortfolioStore } from '@/stores/portfolio'

describe('OverviewTopBar', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    useClockStore().now = new Date('2026-09-22T10:00:00').getTime()
    await usePortfolioStore().load(buildPortfolio(sampleProject, '2026-09-22'))
    useOverviewStore().loadState = 'ready'
  })

  it('標題「所有專案」；頂欄沒有專案數副標；右端是登入者 成員11', () => {
    const w = mount(OverviewTopBar, { attachTo: document.body })
    expect(w.find('h1').text()).toBe('所有專案')
    expect(w.text()).not.toContain('個需要注意')
    expect(w.find('.tail').text()).toContain('成員11')
    w.unmount()
  })

  it('成員觸發鈕：沒勾人時顯示前三位頭像加「…」、沒有數字', () => {
    const w = mount(OverviewTopBar, { attachTo: document.body })
    const trig = w.find('[data-ov-dd="pm"] .dd-trigger')
    expect(trig.findAll('.mp-stack > *').length).toBe(3)
    expect(trig.text()).toContain('…')
    expect(trig.find('.mp-count').exists()).toBe(false)
    w.unmount()
  })

  it('成員選單：四位 PM、計數與紅點；勾選後觸發鈕只剩勾的人、出現「清除勾選」', async () => {
    const w = mount(OverviewTopBar, { attachTo: document.body })
    const ov = useOverviewStore()
    await w.find('[data-ov-dd="pm"] button.dd-trigger').trigger('click')
    const opts = w.findAll('[data-pm-option]')
    expect(opts.map((o) => o.attributes('data-pm-option'))).toEqual(['m5', 'm8', 'm9', 'm10'])
    expect(opts[0]!.text()).toContain('進行中 2')
    expect(opts[2]!.text()).toContain('未開始 1')
    expect(opts[0]!.find('.alert-dot').exists()).toBe(true)
    expect(opts[2]!.find('.alert-dot').exists()).toBe(false)
    expect(w.find('.mp-tools .mp-btn').exists()).toBe(false)
    await opts[0]!.trigger('click')
    expect(ov.pmIds).toEqual(['m5'])
    expect(opts[0]!.attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-ov-dd="pm"] .mp-count').text()).toBe('1')
    await w.find('.mp-tools .mp-btn').trigger('click')
    expect(ov.pmIds).toEqual([])
    w.unmount()
  })

  it('狀態下拉：選項順序 未開始 / 進行中 / 已完成；勾一個後 label 變「狀態 1」', async () => {
    const w = mount(OverviewTopBar, { attachTo: document.body })
    await w.find('[data-ov-dd="status"] button.dd-trigger').trigger('click')
    const items = w.findAll('[data-ov-dd="status"] .dd-item')
    expect(items.map((i) => i.text().replace('✓', '').trim())).toEqual(['未開始', '進行中', '已完成'])
    await items[0]!.trigger('click')
    expect(w.find('[data-ov-dd="status"] .dd-trigger').text()).toContain('狀態 1')
    w.unmount()
  })

  it('沒篩選時清除鈕 disabled；有篩選時點了會清掉', async () => {
    const w = mount(OverviewTopBar, { attachTo: document.body })
    const ov = useOverviewStore()
    expect(w.find('[data-testid="overview-clear"]').attributes('disabled')).toBeDefined()
    ov.toggleStatus('todo')
    await w.vm.$nextTick()
    await w.find('[data-testid="overview-clear"]').trigger('click')
    expect(ov.anyFilter).toBe(false)
    w.unmount()
  })

  it('檢視切換：aria-pressed 跟著 view', async () => {
    const w = mount(OverviewTopBar, { attachTo: document.body })
    await w.find('[data-view-switch="timeline"]').trigger('click')
    expect(useOverviewStore().view).toBe('timeline')
    expect(w.find('[data-view-switch="timeline"]').attributes('aria-pressed')).toBe('true')
    w.unmount()
  })

  it('資料還沒到時三個篩選都 disabled', async () => {
    useOverviewStore().loadState = 'loading'
    const w = mount(OverviewTopBar, { attachTo: document.body })
    for (const k of ['pm', 'status', 'alert']) {
      expect(w.find(`[data-ov-dd="${k}"] .dd-trigger`).attributes('disabled')).toBeDefined()
    }
    w.unmount()
  })
})
